import { Role, type User } from '@/types/api';

/**
 * =============================================================================
 * THE PERMISSION MODEL
 * =============================================================================
 * !! READ THIS FIRST !!
 *
 *   NOTHING IN THIS FILE IS A SECURITY CONTROL.
 *
 * Every rule here is a MIRROR of a rule the NestJS backend enforces. Its only
 * job is to decide what UI to render, so a user is not shown a button that will
 * fail with a 403 when they press it.
 *
 * Anyone can delete this module in DevTools, edit the bundle, or call the API
 * with curl. The backend's guards are the boundary - verified in the
 * authorization audit, where an unrelated user got 404 on every task route
 * regardless of what any client believed.
 *
 * THE INTERVIEW ANSWER, and it must be unambiguous: frontend authorization is
 * a USABILITY feature. It prevents confusion, not access. If the only thing
 * stopping an action is a hidden button, the action is not protected.
 *
 * -----------------------------------------------------------------------------
 * THE PART THAT IS ACTUALLY SUBTLE: TWO ROLE SYSTEMS, ONE ENUM
 * -----------------------------------------------------------------------------
 * The backend reuses the same `Role` enum for two different things, and
 * conflating them is the easiest mistake to make here:
 *
 *   GLOBAL ROLE    lives on the User, travels in the JWT.
 *                  `admin` is a platform administrator - they bypass every
 *                  project check. `manager` and `member` as GLOBAL roles mean
 *                  almost nothing on their own.
 *
 *   PROJECT ROLE   lives on ProjectMember, one per project per user.
 *                  This is what `@ProjectRoles(Role.MANAGER)` checks. A user
 *                  can be a MANAGER of project A and a MEMBER of project B
 *                  simultaneously.
 *
 * So "is this user a manager?" is not a question with an answer. "Is this user
 * a manager OF THIS PROJECT?" is. That is why `can()` takes a context rather
 * than just a user - a permission check without a subject is usually a bug.
 * =============================================================================
 */

/**
 * Every capability the UI needs to reason about, as a string union.
 *
 * WHY A UNION AND NOT `string`: a typo becomes a compile error, editors
 * autocomplete the list, and adding a capability forces every exhaustive
 * `switch` over it to be updated. The same argument as the `TaskStatus` union
 * in Phase 2, applied to authorization.
 *
 * NAMED `resource:action`, which is the convention most teams converge on. It
 * sorts readably and it makes the resource obvious at a call site.
 */
export type Capability =
  /* --- platform-wide, decided by the GLOBAL role only ------------------- */
  | 'users:read'
  | 'users:manage'
  | 'activity-logs:read'
  | 'health:detail'
  /* --- project-scoped, decided by the PROJECT role ---------------------- */
  | 'project:read'
  | 'project:update'
  | 'project:archive'
  | 'project:members:manage'
  | 'task:create'
  | 'task:update'
  | 'task:delete'
  | 'comment:create'
  | 'comment:delete';

/**
 * What a rule may consult besides the user's global role.
 *
 * `projectRole` is `Role | null | undefined` and the three are DIFFERENT:
 *   Role.X     the caller's role in the project under consideration
 *   null       the caller is NOT a member of it
 *   undefined  no project context was supplied - we do not know
 *
 * Collapsing `null` and `undefined` would make "not a member" and "did not
 * ask" indistinguishable, and the safe answer differs: deny for the first,
 * and for the second the caller has probably forgotten to pass context, which
 * should be visible rather than silently denied.
 */
export interface PermissionContext {
  /** The caller's role WITHIN the project being acted on. */
  projectRole?: Role | null;
  /** For authorship rules - e.g. deleting your own comment. */
  authorId?: string;
}

/**
 * =============================================================================
 * THE RULES - each one cites the backend code it mirrors
 * =============================================================================
 * A PURE FUNCTION taking the user explicitly, NOT a hook.
 *
 * WHY THAT MATTERS: it is testable with no React at all (see the test file -
 * it contains no `render`), and it is callable from places a hook cannot go,
 * such as a route loader or a Redux selector. The React binding is a thin
 * wrapper in `usePermissions`.
 *
 * Same discipline as the Phase 3 reducer: put the logic in a pure function,
 * and let the hook be plumbing.
 * =============================================================================
 */
export function can(
  user: User | null,
  capability: Capability,
  context: PermissionContext = {},
): boolean {
  // Not signed in: nothing is permitted. The route guard should have caught
  // this already, but a permission function that assumes a user is a
  // permission function that throws on the login page.
  if (!user) return false;

  /**
   * THE GLOBAL ADMIN SHORT-CIRCUIT.
   *
   * Mirrors `if (user.role === Role.ADMIN) return true` at the top of both
   * ProjectAccessGuard and TaskAccessGuard. Keeping the shape identical is
   * deliberate: if the client and server disagree about what admin means, the
   * UI shows buttons that 403 - which is the exact confusion this file exists
   * to prevent.
   */
  if (user.role === Role.ADMIN) return true;

  const { projectRole, authorId } = context;
  const isProjectMember = projectRole === Role.MANAGER || projectRole === Role.MEMBER;
  const isProjectManager = projectRole === Role.MANAGER;

  switch (capability) {
    /* --- platform-wide -------------------------------------------------- */

    /**
     * backend: `@Roles(Role.ADMIN)` on the UsersController CLASS, and on
     * ActivityLogsController. `/health/detail` gained the same in the audit.
     *
     * The global-admin short-circuit above already returned true, so reaching
     * here means the user is not an admin - hence `false` for all four.
     */
    case 'users:read':
    case 'users:manage':
    case 'activity-logs:read':
    case 'health:detail':
      return false;

    /* --- project-scoped ------------------------------------------------- */

    /** backend: ProjectAccessGuard with no @ProjectRoles - membership is enough. */
    case 'project:read':
      return isProjectMember;

    /**
     * backend: `@ProjectRoles(Role.MANAGER)` on PATCH /projects/:id,
     * POST /:id/archive, POST /:id/members, DELETE /:id/members/:userId.
     */
    case 'project:update':
    case 'project:archive':
    case 'project:members:manage':
      return isProjectManager;

    /**
     * backend: TaskAccessGuard with no @ProjectRoles on the task routes, and
     * ProjectAccessGuard on POST /tasks.
     *
     * ANY MEMBER MAY EDIT OR DELETE A TASK, which is worth noticing rather
     * than assuming. It is a deliberate product choice - a shared project
     * means shared work - and if it were ever tightened to managers-only, the
     * change would need to happen in BOTH places or the UI starts lying.
     *
     * That duplication is the standing cost of client-side authorization, and
     * it is why every rule here cites its source.
     */
    case 'task:create':
    case 'task:update':
    case 'task:delete':
    case 'comment:create':
      return isProjectMember;

    /**
     * backend: TasksService.removeComment - author, project MANAGER, or global
     * ADMIN. The only rule here that depends on the RESOURCE and not just the
     * actor, which is exactly why `can()` takes a context.
     *
     * A permission model that cannot express "your own" is a permission model
     * that will be worked around.
     */
    case 'comment:delete':
      return isProjectManager || (isProjectMember && authorId === user.id);

    default: {
      /**
       * EXHAUSTIVENESS. Add a capability to the union and forget its case, and
       * `capability` is not assignable to `never` - so THIS LINE fails to
       * compile.
       *
       * `default: return false` would be the tempting alternative and is worse
       * in a security-adjacent file: a new capability would silently deny
       * everybody, the feature would appear broken rather than unguarded, and
       * somebody would "fix" it by loosening a rule.
       */
      const exhaustive: never = capability;
      return exhaustive;
    }
  }
}
