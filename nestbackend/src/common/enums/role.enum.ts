/**
 * =============================================================================
 * Role - the global (application-wide) role of a user.
 * =============================================================================
 * WHY IS THIS IN `common/` AND NOT IN `users/`?
 *
 * The rule stated in app.module.ts is: nothing in `common/` may import from a
 * feature module. That rule is about DEPENDENCIES, not about topic. `Role` is a
 * pure value type - zero imports, zero behaviour, no knowledge of persistence
 * or HTTP - so putting it in `common/` creates no coupling in either direction.
 *
 * The alternative (exporting it from `users/`) would force `common/guards/
 * roles.guard.ts` in Phase 8 to import from a feature module, which is exactly
 * the inversion we want to prevent. Shared *pure data* like enums, error codes
 * and pagination shapes is the legitimate content of a "shared kernel".
 *
 * The test to apply: if this file ever needs an import from `users/`, it has
 * stopped being shared-kernel material and must move.
 *
 * -----------------------------------------------------------------------------
 * WHY STRING VALUES INSTEAD OF A NUMERIC ENUM?
 * TypeScript's default `enum Role { ADMIN, MANAGER }` stores 0, 1, 2. Then:
 *   - Your database rows read `{ role: 0 }`, which nobody can debug.
 *   - Inserting a new member in the middle silently renumbers every existing
 *     record - a genuine data-corruption bug.
 *   - JSON API responses expose meaningless integers.
 * String enums cost a few bytes and remove all three problems.
 *
 * NOTE: this is a GLOBAL role. TaskFlow also has a PROJECT-level role
 * (a user can be a manager of project A and a plain member of project B), which
 * lives on the project membership record. Conflating the two is the classic
 * RBAC modelling mistake, and Phase 8 builds the guard that handles both.
 * =============================================================================
 */
export enum Role {
  /** Full access, including user administration. */
  ADMIN = 'admin',
  /** Can create projects and manage tasks across the projects they own. */
  MANAGER = 'manager',
  /** Default role: can work on tasks in projects they belong to. */
  MEMBER = 'member',
}
