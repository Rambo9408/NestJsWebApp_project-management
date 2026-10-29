import {
  ForbiddenException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { CommentView, CommentsRepository } from 'src/comments/comments.repository';
import { Role } from 'src/common/enums/role.enum';
import { CommentsService } from 'src/comments/comments.service';
import { Paginated, PaginationQuery, paginate } from 'src/common/dto/pagination.query';
import { TransactionRunner } from 'src/database/transaction.runner';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationType } from 'src/notifications/schemas/notification.schema';
import { ProjectStatus } from 'src/projects/entities/project.entity';
import { ProjectsService } from 'src/projects/projects.service';
import { UsersService } from 'src/users/users.service';

import { AssignTaskDto, ChangeTaskStatusDto, CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { TaskPriority } from './schemas/task.schema';
import {
  ProjectTaskStats,
  TaskFilter,
  TaskView,
  TaskWithAssignee,
  TasksRepository,
} from './tasks.repository';

/**
 * =============================================================================
 * TasksService
 * =============================================================================
 * The busiest service in the project, and the one where the database features
 * from this phase actually pay off:
 *
 *   - `create`   : atomic sequence (`$inc`) for the human-readable reference
 *   - `changeStatus` : conditional update = optimistic concurrency
 *   - `remove`   : a multi-collection TRANSACTION (task + its comments)
 *   - `stats`    : an aggregation pipeline instead of an application-side loop
 *
 * Note the dependency direction, which is unchanged from earlier phases: this
 * service depends on `ProjectsService` and `UsersService` (both exported
 * contracts) and never on their repositories.
 * =============================================================================
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly tasksRepository: TasksRepository,
    /**
     * The REPOSITORY, not just the service - because the cascading-delete
     * transaction needs to pass a MongoDB session into the comment deletion,
     * and a service method that hides the session cannot participate in a
     * transaction. `CommentsModule` exports it for exactly this reason, and
     * says so.
     */
    private readonly commentsRepository: CommentsRepository,
    private readonly commentsService: CommentsService,
    private readonly projectsService: ProjectsService,
    private readonly usersService: UsersService,
    private readonly notifications: NotificationsService,
    private readonly transactions: TransactionRunner,
  ) {}

  async create(dto: CreateTaskDto, createdById: string): Promise<TaskView> {
    const project = await this.projectsService.findById(dto.projectId);
    if (project.status === ProjectStatus.ARCHIVED) {
      throw new ConflictException('Cannot add tasks to an archived project');
    }

    await this.usersService.findById(createdById);

    /**
     * BUSINESS RULE: you can only assign work to someone who is on the project.
     *
     * Note this reads membership off the project we ALREADY loaded rather than
     * issuing another query. Small, but it is the difference between two round
     * trips and three on the hottest write path in the app.
     */
    if (dto.assigneeId) {
      await this.assertIsMember(project.id, dto.assigneeId, project.members);
    }

    const reference = await this.tasksRepository.nextReference(project.key);

    const task = await this.tasksRepository.create({
      title: dto.title.trim(),
      description: dto.description?.trim() ?? '',
      projectId: project.id,
      createdById,
      assigneeId: dto.assigneeId ?? null,
      priority: dto.priority ?? TaskPriority.MEDIUM,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      reference,
    });

    this.logger.log(`Task created: ${task.reference}`);

    if (task.assigneeId) await this.notifyAssignee(task);

    return task;
  }

  async findAll(
    filter: TaskFilter,
    pagination: PaginationQuery,
  ): Promise<Paginated<TaskWithAssignee>> {
    const { items, total } = await this.tasksRepository.findAll(filter, pagination);
    return paginate(items, total, pagination);
  }

  async findById(id: string): Promise<TaskView> {
    const task = await this.tasksRepository.findById(id);
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<TaskView> {
    await this.findById(id);

    const updated = await this.tasksRepository.update(id, {
      ...(dto.title ? { title: dto.title.trim() } : {}),
      ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
      ...(dto.priority ? { priority: dto.priority } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
    });

    if (!updated) throw new NotFoundException(`Task ${id} not found`);
    return updated;
  }

  /**
   * A CONDITIONAL status transition.
   *
   * The client sends both `from` and `to`. The repository turns that into
   * `findOneAndUpdate({ _id, status: from }, { $set: { status: to } })`, so the
   * check and the write are ONE atomic operation.
   *
   * If it matches nothing, either the task is gone or someone else moved it
   * first - and 409 Conflict is the honest answer, because the client's view of
   * the world is stale. Compare with read-modify-write, which would silently
   * discard the other person's change and report success.
   */
  async changeStatus(id: string, dto: ChangeTaskStatusDto): Promise<TaskView> {
    if (dto.from === dto.to) {
      // Idempotent: asking for the state it is already in is success.
      return this.findById(id);
    }

    const updated = await this.tasksRepository.changeStatus(id, dto.from, dto.to);

    if (!updated) {
      const current = await this.tasksRepository.findById(id);
      if (!current) throw new NotFoundException(`Task ${id} not found`);

      throw new ConflictException(
        `Task ${current.reference} is in "${current.status}", not "${dto.from}" - someone changed it first`,
      );
    }

    return updated;
  }

  async assign(id: string, dto: AssignTaskDto): Promise<TaskView> {
    const task = await this.findById(id);

    if (dto.assigneeId) {
      const project = await this.projectsService.findById(task.projectId);
      await this.assertIsMember(project.id, dto.assigneeId, project.members);
    }

    const updated = await this.tasksRepository.update(id, { assigneeId: dto.assigneeId });
    if (!updated) throw new NotFoundException(`Task ${id} not found`);

    if (updated.assigneeId) await this.notifyAssignee(updated);

    return updated;
  }

  /**
   * ===========================================================================
   * DELETE A TASK AND ITS COMMENTS - the transaction
   * ===========================================================================
   * Two collections must change together. Without a transaction, a crash
   * between the two deletes leaves orphaned comments pointing at a task that no
   * longer exists - invisible until someone runs a report and the numbers do
   * not add up.
   *
   * THINGS THAT MATTER IN HERE:
   *   - EVERY operation receives the `session`. One that forgets runs outside
   *     the transaction and will not roll back. This is the single most common
   *     transaction bug, and it fails silently.
   *   - The callback MAY RUN TWICE. `withTransaction` retries transient errors,
   *     so the body must be idempotent: no counters on captured variables, and
   *     - critically - NO NOTIFICATIONS OR EXTERNAL CALLS INSIDE. You cannot
   *     roll back an email. Side effects go after the commit (and, better
   *     still, into a queue - Phase 12).
   *   - Keep it SHORT. Transactions hold locks and hit a 60-second default
   *     lifetime limit; doing anything slow inside is how you turn a correctness
   *     tool into an availability problem.
   *
   * WOULD A BETTER DATA MODEL AVOID THIS? Yes - embedding comments in the task
   * document would make the delete a single atomic write. We chose references
   * because comment counts are unbounded. That is the trade-off, and being able
   * to state it both ways is the point.
   * ===========================================================================
   */
  async remove(id: string): Promise<{ deletedComments: number }> {
    const task = await this.findById(id);

    const deletedComments = await this.transactions.run(async (session) => {
      const removedComments = await this.commentsRepository.removeByTask(task.id, session);

      const removed = await this.tasksRepository.remove(task.id, session);
      if (!removed) {
        // Throwing inside the callback aborts the transaction, so the comment
        // deletions above are rolled back too. That is the whole point.
        throw new NotFoundException(`Task ${id} disappeared during deletion`);
      }

      return removedComments;
    });

    this.logger.log(`Task ${task.reference} deleted with ${deletedComments} comment(s)`);
    return { deletedComments };
  }

  /** Aggregation instead of an application-side loop - see the repository. */
  async statsByProject(projectId: string): Promise<ProjectTaskStats[]> {
    await this.projectsService.findById(projectId);
    return this.tasksRepository.statsByProject(projectId);
  }

  /**
   * Comment operations are delegated, but the TASK CHECK happens here.
   *
   * That is what keeps the dependency acyclic: `CommentsService` never needs to
   * know whether a task exists, so it never needs `TasksService`, so there is no
   * cycle to break. See the header comment in `comments.service.ts` - this is
   * Phase 4's "option 3" applied BEFORE the cycle existed rather than after,
   * which is cheaper every time.
   */
  async addComment(taskId: string, body: string, authorId: string): Promise<CommentView> {
    const task = await this.findById(taskId);
    return this.commentsService.create(task.id, { body, authorId });
  }

  async listComments(taskId: string, pagination: PaginationQuery): Promise<Paginated<CommentView>> {
    const task = await this.findById(taskId);
    return this.commentsService.listForTask(task.id, pagination);
  }

  /**
   * ===========================================================================
   * DELETE A COMMENT - author, project MANAGER, or global ADMIN
   * ===========================================================================
   * THIS LIVES HERE, NOT IN CommentsService, and the reason is the whole point.
   *
   * The moderation rule needs the ownership chain comment -> task -> project ->
   * membership. `CommentsService` cannot see past the comment: it has no access
   * to tasks or projects, and giving it any would create a CYCLE, because
   * `TasksModule` already imports `CommentsModule` for the cascading-delete
   * transaction.
   *
   * `TasksService` already sits at the join of all three - it holds
   * `commentsRepository`, `commentsService` AND `projectsService`. So the rule
   * that needs all three belongs here. No new dependency, no cycle, no
   * `forwardRef`.
   *
   * THE GENERAL LESSON: when a rule needs data from two modules, it belongs in
   * whichever module already legitimately depends on both - not in the one that
   * merely owns the noun. Putting `deleteComment` in "the comments service"
   * feels tidier and is what forces the cycle.
   *
   * (The earlier author-or-admin rule in CommentsService stays as the guard for
   * the standalone route, which is now deprecated - see CommentsController.)
   * ===========================================================================
   */
  async removeComment(
    taskId: string,
    commentId: string,
    actor: { id: string; role: Role },
  ): Promise<void> {
    // TaskAccessGuard has already established that the actor can see this task.
    const task = await this.findById(taskId);
    const comment = await this.commentsRepository.findById(commentId);

    /**
     * BOTH the "missing" and the "wrong task" cases return the same 404.
     *
     * Checking `comment.taskId !== task.id` matters: without it, a member of
     * project A could delete a comment on project B's task simply by pairing a
     * task id they CAN see with a comment id they cannot. The guard authorises
     * the TASK in the URL; nothing else authorises the comment, so the two must
     * be proven to belong together.
     *
     * That mismatch - authorising one identifier and acting on another - is a
     * classic and easily-missed IDOR, and it only appears on nested routes.
     */
    if (!comment || comment.taskId !== task.id) {
      throw new NotFoundException(`Comment ${commentId} not found`);
    }

    const isAuthor = comment.authorId === actor.id;
    const isGlobalAdmin = actor.role === Role.ADMIN;

    if (!isAuthor && !isGlobalAdmin) {
      // Not the author: only a MANAGER of this project may moderate.
      const project = await this.projectsService.findById(task.projectId);
      const membership = project.members.find((member) => member.userId === actor.id);

      if (membership?.role !== Role.MANAGER) {
        throw new ForbiddenException('Only the author or a project manager can delete a comment');
      }
    }

    const removed = await this.commentsRepository.softDelete(commentId);
    if (!removed) throw new NotFoundException(`Comment ${commentId} not found`);
  }

  private async assertIsMember(
    projectId: string,
    userId: string,
    members: { userId: string }[],
  ): Promise<void> {
    await this.usersService.findById(userId);

    if (!members.some((member) => member.userId === userId)) {
      throw new ConflictException(
        `User ${userId} is not a member of project ${projectId}; add them first`,
      );
    }
  }

  private async notifyAssignee(task: TaskView): Promise<void> {
    if (!task.assigneeId) return;

    const assignee = await this.usersService.findById(task.assigneeId);

    // PHASE 11: notifyUser persists the notification, pushes it to every
    // instance for SSE/WebSocket delivery, AND sends it out of band. See the
    // ordering note in notifications.service.ts - durable first.
    await this.notifications.notifyUser({
      userId: assignee.id,
      email: assignee.email,
      type: NotificationType.TASK_ASSIGNED,
      title: `${task.reference} assigned to you`,
      body: `"${task.title}" is now yours.`,
      meta: { taskId: task.id, reference: task.reference },
    });
  }
}
