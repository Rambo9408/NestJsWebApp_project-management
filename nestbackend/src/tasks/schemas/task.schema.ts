import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { baseSchemaOptions } from 'src/database/schema.helpers';

export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  IN_REVIEW = 'in_review',
  DONE = 'done',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

/**
 * =============================================================================
 * Task - the collection that shows why REFERENCES exist
 * =============================================================================
 * Tasks are a separate collection rather than an array inside `Project`,
 * because the number of tasks per project is UNBOUNDED. Embedding them would:
 *   - grow the project document toward the 16MB limit,
 *   - make every read of a project pull every task,
 *   - and make "all tasks assigned to me across projects" impossible to index.
 *
 * That is the embed-vs-reference rule applied in the other direction from
 * `ProjectMember`: embed bounded, owned, read-together data; reference
 * unbounded or independently-queried data.
 * =============================================================================
 */
@Schema({
  ...baseSchemaOptions,
  collection: 'tasks',

  /**
   * OPTIMISTIC CONCURRENCY, turned on where it actually matters.
   *
   * Two people dragging the same task on a board is a realistic race. With this
   * flag, `save()` includes `__v` in its filter and increments it; if someone
   * else saved in between, the filter matches nothing and Mongoose throws
   * `VersionError` instead of silently overwriting their change.
   *
   * WHY NOT PESSIMISTIC LOCKING? MongoDB has no row locks to take, and holding
   * a lock across a user's think-time is a scalability disaster in any database.
   * Optimistic concurrency assumes conflicts are rare, detects them, and asks
   * the loser to retry - which is the right trade-off for collaborative editing.
   *
   * NOTE the honest caveat: this only applies to `save()` on a hydrated
   * document. `findByIdAndUpdate` bypasses it entirely, which is why the
   * status-change path in the repository uses a conditional update instead.
   */
  optimisticConcurrency: true,
})
export class Task {
  @Prop({ required: true, trim: true, maxlength: 200 })
  title: string;

  @Prop({ default: '', trim: true, maxlength: 5000 })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId: Types.ObjectId;

  /**
   * Nullable on purpose - an unassigned task is a normal state, not a missing
   * value. `default: null` makes that explicit rather than leaving the field
   * absent, so `{ assigneeId: null }` is a queryable state.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assigneeId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdById: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(TaskStatus), default: TaskStatus.TODO })
  status: TaskStatus;

  @Prop({ required: true, enum: Object.values(TaskPriority), default: TaskPriority.MEDIUM })
  priority: TaskPriority;

  /**
   * A human-facing reference like `WEB-142`, denormalised from the project key.
   *
   * DENORMALISATION, deliberately: the alternative is joining to `projects` on
   * every task read just to render a label. The cost is that renaming a project
   * key would require updating every task - which is exactly why the project
   * key is immutable (see `UpdateProjectDto`). Denormalisation is safe when the
   * source is immutable; it is a maintenance bomb when it is not.
   */
  /**
   * NOTE: NO `index: true` here, even though this field is heavily queried.
   *
   * The unique index is declared once, below, with `TaskSchema.index(...)`.
   * Declaring it in BOTH places is a real bug that I hit while writing this
   * phase, and the failure is instructive:
   *
   *     [MONGOOSE] Warning: Duplicate schema index on {"reference":1} found.
   *     SyncIndexesError: An existing index has the same name as the requested
   *     index... Requested: { unique: true, key: { reference: 1 } },
   *     existing: { key: { reference: 1 } }
   *
   * Both definitions generate the same auto-derived NAME (`reference_1`) with
   * DIFFERENT options, so the second cannot be created. In development with
   * `autoIndex` you get a warning and silently keep whichever was created
   * first - which may be the NON-unique one. Duplicates get created, and the
   * constraint you thought you had never existed.
   *
   * RULE: declare a field's index in exactly one place. Use `@Prop({ index })`
   * for simple single-field indexes, and `Schema.index()` for anything with
   * options (unique, partial, compound, TTL) - never both for the same field.
   */
  @Prop({ required: true })
  reference: string;

  @Prop({ type: Date, default: null })
  dueDate: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type TaskDocument = HydratedDocument<Task>;

export const TaskSchema = SchemaFactory.createForClass(Task);

/**
 * -----------------------------------------------------------------------------
 * INDEXES - each one earns its place by serving a real query
 * -----------------------------------------------------------------------------
 * ESR: Equality, Sort, Range.
 */

/** "The board for this project" - the single hottest query in the app. */
TaskSchema.index({ projectId: 1, status: 1, createdAt: -1 });

/** "My tasks", across all projects. */
TaskSchema.index({ assigneeId: 1, status: 1, dueDate: 1 });

/** `WEB-142` lookups; unique because a reference identifies exactly one task. */
TaskSchema.index({ reference: 1 }, { unique: true });

/**
 * A PARTIAL index for "overdue work". Only unfinished tasks with a due date are
 * indexed, which is a small fraction of the collection - and an index that
 * stays small stays in RAM.
 *
 * `$ne` inside `partialFilterExpression` is not supported by MongoDB, so the
 * filter is expressed as an explicit `$in` of the open states. That restriction
 * catches people out; the workaround is worth remembering.
 */
TaskSchema.index(
  { dueDate: 1 },
  {
    partialFilterExpression: {
      dueDate: { $type: 'date' },
      status: { $in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW] },
    },
  },
);
