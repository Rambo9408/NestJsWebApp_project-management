import { Role } from 'src/common/enums/role.enum';

/**
 * A project's lifecycle state.
 *
 * WHY A STATUS FIELD INSTEAD OF DELETING? Because projects have history -
 * tasks, comments, activity logs - and hard-deleting orphans all of it.
 * "Archived" is a soft delete with an honest name.
 *
 * The cost of soft deletes, stated plainly: EVERY query must now remember to
 * filter `status: ACTIVE`, and the one that forgets shows archived data to
 * users. In Phase 5 that filter is centralised in the repository (and can be
 * enforced with a Mongoose query middleware / global filter), which is exactly
 * the kind of leak the repository layer exists to plug.
 */
export enum ProjectStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

/**
 * Membership - and the modelling decision worth defending in an interview.
 *
 * A user has a GLOBAL role (`Role` on the user) AND a PER-PROJECT role (here).
 * Ana can be a MANAGER of the Website project and a plain MEMBER of the Mobile
 * project. Collapsing these into one field is the classic RBAC modelling
 * mistake: you end up either granting far too much (global manager = manager
 * everywhere) or bolting on special cases forever.
 *
 * The consequence for authorization is that a role check alone is never enough:
 * "is this user a MANAGER?" must become "is this user a MANAGER *of this
 * project*?" Phase 8 builds exactly that - a `RolesGuard` for the global role,
 * and a `ProjectMemberGuard` that loads membership for the requested resource.
 * The second one is what interviewers mean by "resource-level authorization",
 * and it is where most implementations are hand-waved.
 */
export interface ProjectMember {
  userId: string;
  role: Role;
  joinedAt: Date;
}

export interface Project {
  id: string;

  /**
   * A short human-readable key, e.g. `WEB`. Used in task references (`WEB-142`).
   *
   * WHY A SECOND IDENTIFIER when we already have `id`? Because humans cannot
   * say a UUID out loud. This is a deliberate, common design: an opaque
   * technical id for machines, a stable readable key for people. It is also a
   * uniqueness constraint you must actually enforce - Phase 5 adds a unique
   * index on it.
   */
  key: string;

  name: string;
  description: string;

  /** The owning user's id. */
  ownerId: string;

  members: ProjectMember[];
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * WHY IS THERE NO `toPublicProject()` HERE, when `User` had one?
 *
 * Because a Project contains no secrets - there is nothing to strip. Adding a
 * mapping function anyway would be ceremony. The rule is not "always map"; it
 * is "map wherever the domain model and the wire model differ, and always where
 * secrets exist". Applying patterns uniformly rather than where they pay is how
 * codebases get bloated.
 *
 * That said, this type WILL diverge: Phase 5 adds a Mongoose document with
 * `_id`/`__v`, and the API should keep exposing `id`. The mapping appears then,
 * for a reason, rather than now, on principle.
 */
