import { Role } from 'src/common/enums/role.enum';

/**
 * =============================================================================
 * DOMAIN EVENTS - the vocabulary
 * =============================================================================
 * A domain event is a statement of FACT, in the PAST TENSE, about something
 * that has already happened.
 *
 * That grammar is not style. Compare:
 *
 *     sendWelcomeEmail(user)        a COMMAND - the caller decides what happens
 *     UserRegistered { user }       an EVENT  - the caller states what occurred
 *
 * A command has exactly one handler and the caller owns the outcome. An event
 * has zero or many, and the emitter does not know or care. That difference is
 * the whole architectural point: `ProjectsService` should not know that adding
 * a member sends an email, writes an activity log, and will one day update a
 * dashboard counter. It knows that a member was added.
 *
 * THE TEST FOR A GOOD EVENT NAME: could you delete every listener and would the
 * emitter still make sense? `project.member_added` survives that;
 * `project.send_member_email` does not - it is a command wearing an event's
 * clothes, and it will acquire a second listener that has nothing to do with
 * email.
 *
 * -----------------------------------------------------------------------------
 * WHAT GOES IN THE PAYLOAD
 * -----------------------------------------------------------------------------
 * Two schools, and both are defensible:
 *
 *   THIN (ids only)   The listener fetches what it needs. Small payloads, no
 *                     staleness, but every listener costs a query - and N
 *                     listeners means N queries for one event.
 *   FAT (full state)  Everything a listener could want. No extra reads, but the
 *                     payload becomes a contract you must version, and it can
 *                     be stale by the time it is handled.
 *
 * This project uses MEDIUM: ids plus the handful of fields every listener needs
 * (an email, a display name), which avoids the most common N+1 without turning
 * events into a second data model.
 *
 * IN-PROCESS events can carry rich objects safely. The moment they cross a
 * broker (Phase 20) they must be serialisable and versioned - which is one more
 * reason to keep payloads small and boring from the start.
 * =============================================================================
 */
export const DomainEvent = {
  USER_REGISTERED: 'user.registered',

  /**
   * A REQUEST, not a fact - and deliberately the only one.
   *
   * It exists to break the `UsersService <-> ProjectsService` cycle from
   * Phase 4: instead of `UsersService` importing `ProjectsService` to ask "does
   * this user own projects?", it ANNOUNCES an intention and lets anyone who
   * cares object. See `users.service.ts` for the full explanation.
   *
   * Note the honest naming: `deletion_requested`, not `user.deleted`. Calling a
   * request an event would be a lie, and the vetoing listener would look like a
   * side effect rather than a decision.
   */
  USER_DELETION_REQUESTED: 'user.deletion_requested',

  PROJECT_MEMBER_ADDED: 'project.member_added',
  PROJECT_ARCHIVED: 'project.archived',

  TASK_CREATED: 'task.created',
  TASK_ASSIGNED: 'task.assigned',
  TASK_STATUS_CHANGED: 'task.status_changed',
  TASK_DELETED: 'task.deleted',

  COMMENT_ADDED: 'comment.added',
} as const;

/** Common context every event carries, so listeners can log and attribute. */
export interface DomainEventBase {
  /** Who caused it. `system` for anything not triggered by a user. */
  actorId: string;
  occurredAt: Date;
}

export interface UserRegisteredEvent extends DomainEventBase {
  userId: string;
  email: string;
  name: string;
}

/**
 * The veto payload.
 *
 * A listener that objects pushes a reason onto `blockers`. `emitAsync` waits
 * for every listener, so by the time the emitter inspects the array, everyone
 * has had their say.
 *
 * WHY A MUTABLE ARRAY rather than collecting return values? Because
 * `emitAsync` returns whatever each listener resolved to, in registration
 * order, and reading meaning out of a heterogeneous array is fragile. A shared
 * collector is explicit about the contract: "add a string if you object".
 *
 * It is also the honest signal that this is NOT a pure event - a listener that
 * mutates the payload is participating in the decision, and pretending
 * otherwise would hide that.
 */
export interface UserDeletionRequestedEvent extends DomainEventBase {
  userId: string;
  blockers: string[];
}

export interface ProjectMemberAddedEvent extends DomainEventBase {
  projectId: string;
  projectKey: string;
  projectName: string;
  memberId: string;
  memberEmail: string;
  role: Role;
}

export interface ProjectArchivedEvent extends DomainEventBase {
  projectId: string;
  projectKey: string;
}

export interface TaskAssignedEvent extends DomainEventBase {
  taskId: string;
  reference: string;
  title: string;
  assigneeId: string;
  assigneeEmail: string;
}

export interface TaskCreatedEvent extends DomainEventBase {
  taskId: string;
  reference: string;
  title: string;
  projectId: string;
}

export interface TaskStatusChangedEvent extends DomainEventBase {
  taskId: string;
  reference: string;
  from: string;
  to: string;
}

export interface TaskDeletedEvent extends DomainEventBase {
  taskId: string;
  reference: string;
  projectId: string;
  deletedComments: number;
}

export interface CommentAddedEvent extends DomainEventBase {
  commentId: string;
  taskId: string;
  authorId: string;
}
