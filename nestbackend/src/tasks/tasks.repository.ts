import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model } from 'mongoose';

import { PaginationQuery } from 'src/common/dto/pagination.query';
import { Counter, CounterDocument } from 'src/database/schemas/counter.schema';
import {
  asRecord,
  idToString,
  escapeRegex,
  toObjectId,
  toObjectIdOrNull,
} from 'src/database/schema.helpers';

import { Task, TaskDocument, TaskPriority, TaskStatus } from './schemas/task.schema';

export interface TaskFilter {
  projectId?: string;
  /**
   * AN AUTHORIZATION SCOPE, not a user-facing filter.
   *
   * When present, only tasks belonging to these projects are returned. It is
   * set by the controller from the CALLER'S MEMBERSHIP and never from the query
   * string - which is the whole point. A client-supplied scope is not a scope.
   *
   * `undefined` means unrestricted, and only a global admin may produce that.
   * An EMPTY ARRAY means "this user is in no projects" and must return NOTHING.
   * That distinction is load-bearing: see `buildFilter`, where treating an
   * empty array as "no filter" would hand a brand-new user the entire database.
   */
  accessibleProjectIds?: string[];
  assigneeId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  search?: string;
  overdue?: boolean;
}

export interface TaskView {
  id: string;
  reference: string;
  title: string;
  description: string;
  projectId: string;
  assigneeId: string | null;
  createdById: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A task with its assignee's public fields resolved - the `populate` result. */
export interface TaskWithAssignee extends TaskView {
  assignee: { id: string; name: string; email: string } | null;
}

export interface ProjectTaskStats {
  status: TaskStatus;
  count: number;
  overdue: number;
}

/**
 * =============================================================================
 * TasksRepository - and a deliberate DEPARTURE from the port pattern
 * =============================================================================
 * `UsersRepository` and `ProjectsRepository` are abstract ports with two
 * implementations each. This one is a plain concrete class, and that is a
 * judgement call rather than an inconsistency.
 *
 * The rule stated in Phase 3 was: "introducing a port for a class you will never
 * swap is architecture theatre." Applied here:
 *
 *   - Users and projects have in-memory implementations because their SERVICES
 *     carry business rules worth unit-testing at speed (unique emails, last
 *     admin, membership). A fake store pays for itself many times over.
 *   - Tasks are tested where their interesting behaviour actually lives: against
 *     a real MongoDB (mongodb-memory-server), because the things worth testing
 *     here ARE the database behaviours - atomic sequences, conditional updates,
 *     aggregation, transactions. An in-memory reimplementation of those would be
 *     a fiction that passes while production breaks.
 *
 * Being able to explain WHY a pattern is applied in one place and not another is
 * worth more in an interview than applying it everywhere.
 * =============================================================================
 */
@Injectable()
export class TasksRepository {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Counter.name) private readonly counterModel: Model<CounterDocument>,
  ) {}

  /**
   * Allocate the next reference number for a project, atomically.
   * See `counter.schema.ts` for why the obvious `count() + 1` is wrong.
   */
  async nextReference(projectKey: string, session?: ClientSession): Promise<string> {
    const counter = await this.counterModel
      .findByIdAndUpdate(
        `task:${projectKey}`,
        { $inc: { seq: 1 } },
        { upsert: true, new: true, session },
      )
      .lean()
      .exec();

    return `${projectKey}-${counter?.seq ?? 1}`;
  }

  async create(
    data: {
      title: string;
      description: string;
      projectId: string;
      createdById: string;
      assigneeId?: string | null;
      priority: TaskPriority;
      dueDate?: Date | null;
      reference: string;
    },
    session?: ClientSession,
  ): Promise<TaskView> {
    /**
     * `create()` with a session must be given an ARRAY - `create([doc], { session })`.
     * The single-document overload silently ignores the options object, so the
     * write happens OUTSIDE the transaction and does not roll back. That is one
     * of the nastiest Mongoose footguns there is, because everything looks
     * correct and only fails under rollback.
     */
    const [created] = await this.taskModel.create(
      [
        {
          title: data.title,
          description: data.description,
          projectId: toObjectId(data.projectId, 'projectId'),
          createdById: toObjectId(data.createdById, 'createdById'),
          assigneeId: toObjectIdOrNull(data.assigneeId ?? undefined),
          priority: data.priority,
          dueDate: data.dueDate ?? null,
          reference: data.reference,
          status: TaskStatus.TODO,
        },
      ],
      { session },
    );

    return mapTask(asRecord(created.toObject()));
  }

  async findById(id: string): Promise<TaskView | null> {
    const found = await this.taskModel.findById(toObjectId(id)).lean().exec();
    return found ? mapTask(found) : null;
  }

  /**
   * The list endpoint, WITH the assignee resolved.
   *
   * -----------------------------------------------------------------------------
   * `populate` AND THE N+1 PROBLEM
   * -----------------------------------------------------------------------------
   * The naive version of "show each task's assignee" is:
   *
   *     const tasks = await taskModel.find(...);                    // 1 query
   *     for (const t of tasks) t.assignee = await userModel.findById(t.assigneeId);  // N queries
   *
   * 50 tasks becomes 51 round trips. Each one is only a millisecond or two, but
   * they are SEQUENTIAL, so the endpoint takes 50-100ms of pure waiting - and it
   * degrades linearly with page size, which is why "it was fast in development"
   * is the usual first report.
   *
   * `populate` fixes it with ONE extra query: Mongoose collects the distinct
   * assignee ids and issues a single `$in` lookup. 51 queries become 2.
   *
   * WHAT populate IS NOT: it is not a SQL JOIN. It happens in the application,
   * in two round trips, and you cannot filter or sort the parent by a populated
   * field - `find().populate('assigneeId').sort('assignee.name')` silently does
   * nothing. When you need to filter or sort across the boundary, you need
   * `$lookup` in an aggregation pipeline, which runs server-side.
   *
   * `select` on the populate is not optional in a real system: without it you
   * fetch every user field on every row - including anything sensitive that is
   * not `select: false`.
   */
  async findAll(
    filter: TaskFilter,
    pagination: PaginationQuery,
  ): Promise<{ items: TaskWithAssignee[]; total: number }> {
    const query = this.buildFilter(filter);

    const [documents, total] = await Promise.all([
      this.taskModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate({ path: 'assigneeId', select: 'name email' })
        .lean()
        .exec(),
      this.taskModel.countDocuments(query).exec(),
    ]);

    return { items: documents.map(mapTaskWithAssignee), total };
  }

  /**
   * A CONDITIONAL UPDATE - "change the status, but only if it is still what I
   * saw."
   *
   * WHY NOT read-modify-write? Because between the read and the write, someone
   * else can change it, and you would overwrite their change without noticing.
   * Putting the expected value in the FILTER makes the check and the write one
   * atomic operation: if it matches nothing, the state moved and we can say so.
   *
   * This is optimistic concurrency without needing a version field, and it is
   * the right tool whenever the transition itself is the thing you care about
   * (a board column, an order state machine, a "claim this job" operation).
   */
  async changeStatus(
    id: string,
    expectedStatus: TaskStatus,
    nextStatus: TaskStatus,
  ): Promise<TaskView | null> {
    const updated = await this.taskModel
      .findOneAndUpdate(
        { _id: toObjectId(id), status: expectedStatus },
        { $set: { status: nextStatus } },
        { new: true, runValidators: true },
      )
      .lean()
      .exec();

    return updated ? mapTask(updated) : null;
  }

  async update(
    id: string,
    patch: Partial<Pick<TaskView, 'title' | 'description' | 'priority' | 'dueDate'>> & {
      assigneeId?: string | null;
    },
  ): Promise<TaskView | null> {
    const update: Record<string, unknown> = { ...patch };
    if ('assigneeId' in patch) {
      update.assigneeId = toObjectIdOrNull(patch.assigneeId ?? undefined);
    }

    const updated = await this.taskModel
      .findByIdAndUpdate(toObjectId(id), update, { new: true, runValidators: true })
      .lean()
      .exec();

    return updated ? mapTask(updated) : null;
  }

  async remove(id: string, session?: ClientSession): Promise<boolean> {
    const result = await this.taskModel
      .deleteOne({ _id: toObjectId(id) })
      .session(session ?? null)
      .exec();

    return result.deletedCount === 1;
  }

  /**
   * -----------------------------------------------------------------------------
   * AGGREGATION - work the database should do, not the application
   * -----------------------------------------------------------------------------
   * "How many tasks per status, and how many of them are overdue?"
   *
   * The application-side version fetches every task in the project and reduces
   * in JavaScript: O(n) documents over the network, O(n) memory in the Node
   * process, and it gets slower every week. The pipeline below transfers FOUR
   * documents regardless of collection size, and `$match` is served by the
   * `{ projectId, status, createdAt }` index.
   *
   * PIPELINE ORDER IS A PERFORMANCE DECISION, not a style one:
   *   `$match` FIRST, so the index is usable and later stages see fewer
   *   documents. A `$match` placed after a `$group` or `$unwind` cannot use an
   *   index at all - the single most common aggregation mistake.
   *
   * `$cond` inside `$sum` is the idiomatic conditional count: sum 1 when the
   * predicate holds, 0 otherwise.
   */
  async statsByProject(projectId: string): Promise<ProjectTaskStats[]> {
    const now = new Date();

    const rows = await this.taskModel
      .aggregate<{ _id: TaskStatus; count: number; overdue: number }>([
        { $match: { projectId: toObjectId(projectId, 'projectId') } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            overdue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$dueDate', null] },
                      { $lt: ['$dueDate', now] },
                      { $ne: ['$status', TaskStatus.DONE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();

    return rows.map((row) => ({ status: row._id, count: row.count, overdue: row.overdue }));
  }

  async findIdsByProject(projectId: string, session?: ClientSession): Promise<string[]> {
    const rows = await this.taskModel
      .find({ projectId: toObjectId(projectId, 'projectId') }, { _id: 1 })
      .session(session ?? null)
      .lean()
      .exec();

    return rows.map((row) => String(row._id));
  }

  private buildFilter(filter: TaskFilter): FilterQuery<TaskDocument> {
    const query: FilterQuery<TaskDocument> = {};

    const projectId = toObjectIdOrNull(filter.projectId);
    if (projectId) query.projectId = projectId;

    /**
     * =========================================================================
     * THE AUTHORIZATION SCOPE - applied before any user-supplied filter
     * =========================================================================
     * NOTE `!== undefined`, NOT a truthiness check.
     *
     *     if (filter.accessibleProjectIds) { ... }        // WRONG in spirit
     *     if (filter.accessibleProjectIds?.length) { ... } // ACTIVELY DANGEROUS
     *
     * The second is the bug worth naming: an EMPTY array is falsy-ish under
     * `.length`, so a user who belongs to NO projects would fall through to "no
     * scope at all" and receive every task in the database. The exact
     * vulnerability we are fixing would reappear, for precisely the users who
     * should see least.
     *
     * `undefined` means unrestricted (admin). `[]` means "nothing is
     * accessible", and `$in: []` correctly matches zero documents.
     *
     * INTERVIEW-WORTHY: empty-collection handling is where authorization
     * filters usually break, because the happy path is tested and the
     * no-access path is not.
     * =========================================================================
     */
    if (filter.accessibleProjectIds !== undefined) {
      const ids = filter.accessibleProjectIds
        .map((id) => toObjectIdOrNull(id))
        .filter((id): id is NonNullable<typeof id> => id !== null);

      /**
       * COMBINED WITH `projectId` RATHER THAN REPLACING IT. If the caller also
       * asked for one specific project, `query.projectId` is already set above;
       * `$and` means both must hold, so asking for a project you cannot see
       * yields nothing instead of bypassing the scope.
       *
       * Assigning `query.projectId = { $in: ids }` would OVERWRITE the caller's
       * filter - which is a subtler bug: it widens the result set rather than
       * narrowing it.
       */
      query.$and = [...(query.$and ?? []), { projectId: { $in: ids } }];
    }

    const assigneeId = toObjectIdOrNull(filter.assigneeId);
    if (assigneeId) query.assigneeId = assigneeId;

    if (filter.status) query.status = filter.status;
    if (filter.priority) query.priority = filter.priority;

    if (filter.overdue) {
      query.dueDate = { $lt: new Date() };
      query.status = { $ne: TaskStatus.DONE };
    }

    if (filter.search?.trim()) {
      const safe = escapeRegex(filter.search.trim());
      query.$or = [
        { title: { $regex: safe, $options: 'i' } },
        { reference: { $regex: `^${safe}`, $options: 'i' } },
      ];
    }

    return query;
  }
}

function mapTask(document: Record<string, unknown>): TaskView {
  return {
    id: idToString(document._id),
    reference: document.reference as string,
    title: document.title as string,
    description: (document.description as string) ?? '',
    projectId: idToString(document.projectId),
    /**
     * The explicit cast is not noise - ESLint's `no-base-to-string` rule caught
     * a real hazard here. After `populate`, this field holds the user OBJECT,
     * and `String({...})` produces the literal `"[object Object]"`. That is a
     * classic populate bug that ships silently: the response has an `assigneeId`
     * that looks plausible until someone tries to use it. `mapTaskWithAssignee`
     * collapses the populated object back to its `_id` before calling this,
     * so by this point the value really is an id.
     */
    assigneeId: document.assigneeId ? idToString(document.assigneeId) : null,
    createdById: idToString(document.createdById),
    status: document.status as TaskStatus,
    priority: document.priority as TaskPriority,
    dueDate: (document.dueDate as Date) ?? null,
    createdAt: document.createdAt as Date,
    updatedAt: document.updatedAt as Date,
  };
}

/**
 * After `populate`, `assigneeId` is no longer an ObjectId - it is the populated
 * user object (or null). Handling both shapes in one mapper is the price of
 * populate, and a reason some teams prefer an explicit `$lookup` where the
 * output shape is under their control.
 */
function mapTaskWithAssignee(document: Record<string, unknown>): TaskWithAssignee {
  const populated = document.assigneeId as Record<string, unknown> | null;
  const isPopulated = populated !== null && typeof populated === 'object' && 'name' in populated;

  return {
    ...mapTask({
      ...document,
      // After populate,  holds the user OBJECT. Collapse it back to
      // the raw id before the base mapper stringifies it - otherwise you get
      // the literal string "[object Object]" in the response, which is a very
      // common populate bug and one ESLint catches (no-base-to-string).
      assigneeId: isPopulated ? populated._id : populated,
    }),
    assignee: isPopulated
      ? {
          id: idToString(populated._id),
          name: populated.name as string,
          email: populated.email as string,
        }
      : null,
  };
}
