/**
 * =============================================================================
 * THE API CONTRACT
 * =============================================================================
 * Every type here is TRANSCRIBED FROM THE NESTJS BACKEND, not invented.
 * The source of each is cited so it can be re-verified when the backend moves.
 *
 * WHY HAND-WRITTEN AND NOT GENERATED (yet):
 *   The backend runs the @nestjs/swagger CLI plugin, so it produces a real
 *   OpenAPI document at /api/docs-json. `openapi-typescript` can turn that into
 *   types automatically, and for a team that is the right answer - the contract
 *   stops being a thing two people can disagree about.
 *   We hand-write it in Phase 1 for one reason: you should read the backend
 *   controllers once, by hand, before automating it away. Phase 7 wires up
 *   generation and we delete most of this file.
 *
 * INTERVIEW ("how do you keep frontend and backend types in sync?"): the honest
 * senior answer is a generated client from an OpenAPI/schema source of truth,
 * checked in CI so a breaking backend change fails the frontend build. Manually
 * mirrored types drift, and they drift silently.
 * =============================================================================
 */

/* ---------------------------------------------------------------------------
 * ROLES - backend: src/common/enums/role.enum.ts
 *
 * STRING values, not numeric. The backend author called this out: a numeric
 * enum stores 0/1/2, so a role in the database becomes meaningless the day
 * someone reorders the enum. We mirror the string values exactly.
 * ------------------------------------------------------------------------ */
export const Role = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  MEMBER: 'member',
} as const;

/**
 * `as const` + `typeof`/`keyof` instead of a TS `enum`.
 *
 * WHY: `erasableSyntaxOnly` is on in tsconfig (and Node's type-stripping needs
 * it) - a TS `enum` emits real runtime code, so it is not erasable. The const
 * object gives us the same two things an enum does (a runtime value to compare
 * against, and a union type) with zero special syntax.
 *
 * TYPESCRIPT: `typeof Role` is the type of the OBJECT; indexing it with
 * `keyof typeof Role` produces the union of its VALUES:
 *   'admin' | 'manager' | 'member'
 */
export type Role = (typeof Role)[keyof typeof Role];

/* ---------------------------------------------------------------------------
 * TASK enums - backend: src/tasks/schemas/task.schema.ts
 * ------------------------------------------------------------------------ */
export const TaskStatus = {
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review',
  DONE: 'done',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskPriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

/* ---------------------------------------------------------------------------
 * USER - backend: src/users/entities/user.entity.ts
 *
 * The backend type is `PublicUser = Omit<User, 'passwordHash'>`. That Omit is
 * the contract: the hash exists on the server model and is structurally
 * impossible to serialise to us. We mirror the RESULT of the Omit.
 *
 * NOTE createdAt/updatedAt are `Date` on the server and `string` here. JSON has
 * no date type, so what actually arrives over the wire is an ISO-8601 string.
 * Typing these as `Date` is one of the most common frontend lies - it compiles,
 * then `user.createdAt.getFullYear()` throws at runtime. Parse at the edge if
 * you want real Dates; never claim you already have one.
 * ------------------------------------------------------------------------ */
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------------------
 * AUTH - backend: src/auth/auth.controller.ts (register / login)
 *
 * !! THERE IS NO refreshToken IN THIS RESPONSE, AND THAT IS THE WHOLE DESIGN !!
 *
 * The SERVICE returns `TokenPair & { user }` - which does include a refresh
 * token - but the CONTROLLER deliberately does not pass it through:
 *
 *     this.setRefreshCookie(response, result.refreshToken);
 *     return { user, accessToken, expiresIn };   // refreshToken dropped
 *
 * The refresh token leaves the server ONLY as an httpOnly cookie
 * (`taskflow_refresh`; httpOnly, sameSite=strict). JavaScript in the browser -
 * ours or an XSS payload's - cannot read it. That is the entire point: an
 * access token lives 15 minutes, so stealing one is survivable; a refresh token
 * mints new access tokens indefinitely, so stealing one is not.
 *
 * WHY THIS TYPE MATTERS MORE THAN IT LOOKS: the intuitive mirror of the service
 * type would be `TokenPair & { user: User }`, and it would COMPILE. It would
 * simply be wrong - `response.refreshToken` would be `undefined` at runtime,
 * and the natural "fix" is to start storing tokens in localStorage, undoing the
 * security property on purpose. A type that describes the wire accurately makes
 * the secure path the only path that type-checks.
 *
 * VERIFIED against the running server, not read from a comment:
 *     POST /api/v1/auth/register -> 201
 *     {"user":{...},"accessToken":"eyJ...","expiresIn":900}
 *
 * INTERVIEW ("where do you store JWTs in a React app?"): access token in
 * MEMORY (a module variable or Redux - never localStorage, which any XSS can
 * read); refresh token in an httpOnly cookie the client never touches. The
 * cost is that a full page reload loses the access token, so the app calls
 * /auth/refresh on boot to restore the session. Phase 10 builds that.
 * ------------------------------------------------------------------------ */
export interface AuthResponse {
  user: User;
  accessToken: string;
  /** Seconds until the ACCESS token expires (900 = 15 min) - refresh before it. */
  expiresIn: number;
}

/* ---------------------------------------------------------------------------
 * PAGINATION - backend: src/common/dto/pagination.query.ts
 *
 * The envelope every list endpoint returns. `totalPages` is derived server-side
 * so five different clients cannot round it five different ways.
 *
 * A GENERIC interface, because the envelope is identical for users, projects
 * and tasks - only the item type changes. This is the single most useful
 * generic in a typed API client.
 * ------------------------------------------------------------------------ */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Query params accepted by every list endpoint. Backend default page is 1. */
export interface PaginationQuery {
  page?: number;
  limit?: number;
}

/* ---------------------------------------------------------------------------
 * TASKS - backend: src/tasks/dto/task.dto.ts
 * ------------------------------------------------------------------------ */
export interface Task {
  id: string;
  /**
   * A HUMAN-READABLE KEY like "PH-3" - the project key plus a per-project
   * counter. Jira-style.
   *
   * !! THIS FIELD WAS MISSING FROM THIS TYPE UNTIL PHASE 7 !!
   *
   * It was found by printing the keys of a REAL response, not by reading the
   * controller. The hand-written type had been wrong since Phase 1 and nothing
   * complained, because a type that omits a field still compiles - it just
   * makes the field invisible to every consumer. `task.reference` would have
   * been an error in an editor while the data sat there in the payload.
   *
   * THIS IS THE CONCRETE ARGUMENT FOR GENERATED RESPONSE TYPES. The request
   * types cannot drift like this - `npm run api:types` would have surfaced it
   * immediately. Until the backend annotates its responses with
   * `@ApiOkResponse({ type: ... })`, this half of the contract is maintained by
   * hand and verified by inspection, and it will drift again.
   */
  reference: string;
  title: string;
  description?: string;
  projectId: string;
  /** Also found by inspection. The author, distinct from the assignee. */
  createdById: string;
  /**
   * `string | null`, NEVER `string | undefined`.
   *
   * The backend distinguishes them deliberately: `AssignTaskDto.assigneeId` is
   * `string | null` where null means "explicitly unassign". With
   * strictNullChecks on, TypeScript now FORCES every consumer to handle the
   * unassigned case - which is the entire reason we turned strict on.
   */
  assigneeId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/** backend: ListTasksQuery extends PaginationQuery */
export interface ListTasksQuery extends PaginationQuery {
  projectId?: string;
  assigneeId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  search?: string;
}

/* ---------------------------------------------------------------------------
 * ERRORS - backend: src/common/filters/all-exceptions.filter.ts
 *
 * "The one error shape this API ever returns" - a genuinely valuable property.
 * It means the client needs exactly ONE error parser, not one per endpoint.
 *
 * NOTE `message: string | string[]`. The array form is what Nest's
 * ValidationPipe produces: one message per failed field. The backend
 * deliberately preserves the array rather than flattening it, specifically so
 * a frontend can map server validation errors onto individual form fields.
 * We use that in the Forms phase.
 * ------------------------------------------------------------------------ */
export interface ApiError {
  /**
   * A LITERAL `false`, not `boolean`. Backend: `success: false` in
   * ErrorResponse.
   *
   * This makes it a DISCRIMINANT. Because success responses in this API are
   * plain resources with no envelope, `success === false` is a cheap and
   * unambiguous "is this an error body" test - which is exactly what the type
   * guard below uses it for.
   *
   * WORTH KNOWING: the project HAS a TransformResponseInterceptor that would
   * wrap success responses in `{success:true, data:...}`, and deliberately
   * does NOT register it globally - it is opt-in on AppController only. So
   * `GET /tasks` returns a Task, not `Envelope<Task>`. If that interceptor
   * were ever made global, every type in this file would need a wrapper and
   * every call site would need `.data`. That asymmetry (plain successes,
   * enveloped errors) is a deliberate API design decision, and a good one to
   * be able to argue either side of.
   */
  success: false;
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
  /** Correlates a browser error with a backend log line. Show it in error UI. */
  requestId?: string;
}

/**
 * A TYPE GUARD, not a cast.
 *
 * `catch (err)` gives `unknown` (with `useUnknownInCatchVariables`, part of
 * strict). A guard is how you narrow `unknown` to something usable while
 * keeping the compiler's protection. `err as ApiError` would silence the
 * compiler and lie - the runtime value might be a TypeError from our own code,
 * or an nginx HTML error page.
 *
 * The `error is ApiError` return type is what makes this a guard: TypeScript
 * narrows the argument inside any `if` that calls it.
 */
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'success' in error &&
    error.success === false &&
    'statusCode' in error &&
    'message' in error
  );
}

/** Normalises the `string | string[]` message into something renderable. */
export function apiErrorMessages(error: ApiError): string[] {
  return Array.isArray(error.message) ? error.message : [error.message];
}

/* ---------------------------------------------------------------------------
 * PROJECTS - backend: src/projects/entities/project.entity.ts
 *
 * Hand-written, like every response type here, because the OpenAPI document
 * carries no response schemas (see types/requests.ts). Verified against a live
 * `GET /projects` payload rather than transcribed from the interface alone -
 * that discipline is what caught `reference` and `createdById` missing from
 * `Task` in Phase 7.
 * ------------------------------------------------------------------------ */
export const ProjectStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

/**
 * A membership row. `role` here is the PROJECT role, not the user's global one -
 * the same enum used in two different scopes, which is the distinction Phase 10
 * built the permission model around.
 */
export interface ProjectMember {
  userId: string;
  role: Role;
  joinedAt: string;
}

export interface Project {
  id: string;
  /** A short human key like "WEB". Letters only, 2-10 chars - backend @Length. */
  key: string;
  name: string;
  description: string;
  ownerId: string;
  members: ProjectMember[];
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

/** Query params accepted by GET /projects. */
export interface ListProjectsQuery extends PaginationQuery {
  search?: string;
  status?: ProjectStatus;
  /**
   * ADMIN-ONLY IN PRACTICE. The backend now pins non-admins to their own id and
   * silently discards this - see the collection-scoping fix. It stays in the
   * type because an admin support view legitimately uses it.
   */
  memberId?: string;
}

/* ---------------------------------------------------------------------------
 * NOTIFICATIONS - backend: src/notifications/schemas/notification.schema.ts
 *                and notifications.repository.ts (NotificationView)
 * ------------------------------------------------------------------------ */
export const NotificationType = {
  TASK_ASSIGNED: 'task_assigned',
  PROJECT_MEMBER_ADDED: 'project_member_added',
  COMMENT_ADDED: 'comment_added',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /**
   * `Record<string, unknown>` on the server, and deliberately left `unknown`
   * here rather than guessed at.
   *
   * It carries whatever the emitting feature attached - a taskId, a projectId.
   * Typing it as `{ taskId?: string }` would be a claim the contract does not
   * make, and the first notification type that attaches something else would
   * make the type quietly wrong. Narrow it at the point of use with a guard.
   */
  meta: Record<string, unknown>;
  /**
   * `string | null` - null means UNREAD. Not a boolean, because the server
   * stores WHEN it was read, which is strictly more information and costs
   * nothing. `readAt !== null` is the boolean whenever you want one.
   */
  readAt: string | null;
  createdAt: string;
}

/**
 * =============================================================================
 * THE SSE FRAME IS *NOT* A `Notification` - and that is a real trap
 * =============================================================================
 * backend: src/notifications/notification-stream.service.ts `NotificationEvent`
 *
 * The stream publishes a NARROWER type than the REST endpoints return. Compare:
 *
 *   NotificationView (REST)     id userId type title body meta readAt createdAt
 *   NotificationEvent (SSE)     id userId type title body meta        createdAt
 *
 * NO `readAt`. Which is defensible on the server's side - an event that has
 * only just been published is unread by definition, so the field carries no
 * information.
 *
 * THE BUG IT CAUSED HERE, found by capturing a real frame rather than reading
 * the interface: parsing the frame as a `Notification` gives `readAt ===
 * undefined`, not `null`. Every unread check in the app is `readAt === null`,
 * so a brand-new notification rendered as ALREADY READ - no bold, no tint - and
 * clicking it did nothing, because the mark-read guard is also `=== null`.
 * Meanwhile the badge counted it. Visibly inconsistent, and entirely caused by
 * a type that claimed a field the wire does not send.
 *
 * THE FIX IS NORMALISATION AT THE BOUNDARY: parse as `NotificationEvent`,
 * convert to `Notification` explicitly with `readAt: null`. The conversion is
 * where the assumption becomes visible instead of implicit.
 *
 * THE WIDER LESSON, and it is the same one from Phase 7's missing `reference`:
 * two endpoints that describe "the same" resource may not send the same shape.
 * Model each wire format separately and convert between them, rather than
 * hoping one type covers both.
 * =============================================================================
 */
export interface NotificationEvent {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

/**
 * Converts a stream frame into the shape the rest of the app uses.
 *
 * `readAt: null` is an ASSERTION ABOUT THE DOMAIN, not a default: a
 * just-published notification cannot have been read. Writing it explicitly is
 * what makes that reasoning reviewable.
 */
export function notificationFromEvent(event: NotificationEvent): Notification {
  return { ...event, readAt: null };
}

/**
 * =============================================================================
 * Comment - mirrors `CommentView` in nestbackend/src/comments/comments.repository.ts
 * =============================================================================
 * NOTE `author` IS AN EMBEDDED OBJECT, and nullable.
 *
 * The backend joins the author's name so a comment list does not fire one user
 * request per row - the same N+1 problem TaskCard's `assigneeName` prop solves,
 * fixed here on the server instead. That is the better place for it: one query
 * with a lookup beats fifty round trips, and the client cannot fix it at all.
 *
 * WHY IT CAN STILL BE `null`: the author's account may have been deleted while
 * the comment survives. `authorId` is always present (it is the stored foreign
 * key); `author` is the resolved join, which can miss. Rendering has to handle
 * that - see CommentList, which shows "Unknown user" rather than blank.
 *
 * `Date` on the wire is a STRING. The backend types these as `Date` because
 * that is what Mongoose returns, but JSON has no date type, so what actually
 * arrives is an ISO 8601 string. Typing it as `Date` here would compile and
 * then fail at runtime on `.getTime()`. This is the single most common
 * hand-written-type bug against a Node backend.
 * =============================================================================
 */
export interface Comment {
  id: string;
  body: string;
  taskId: string;
  authorId: string;
  author: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * =============================================================================
 * ActivityLog - mirrors `ActivityLogView` in
 * nestbackend/src/activity-logs/activity-logs.controller.ts
 * =============================================================================
 * ADMIN-ONLY, enforced by `@Roles(Role.ADMIN)` on the controller. The frontend
 * capability `activity-logs:read` mirrors that so the nav link does not appear -
 * but as always, the backend is the boundary and the UI is the courtesy.
 *
 * `event` IS AN UNTYPED STRING, deliberately not narrowed to a union here.
 *
 * That is a judgement call worth explaining. A union would give autocomplete
 * and exhaustive switches - and it would also mean that the day the backend
 * emits a new event type, the frontend either fails to compile or silently
 * mishandles a value its type system says is impossible. An audit log is
 * append-only history: it can contain events written by a version of the
 * backend that no longer exists.
 *
 * So `string` is the honest type, and the renderer formats unknown events
 * generically rather than assuming it has seen them all.
 *
 * `payload` is `Record<string, unknown>` for the same reason, and `unknown`
 * rather than `any` forces the render path to narrow before using anything.
 * =============================================================================
 */
export interface ActivityLog {
  id: string;
  event: string;
  actorId: string;
  subjectId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
