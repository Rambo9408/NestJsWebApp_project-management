import { SetMetadata } from '@nestjs/common';

import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'taskflow:roles';

/**
 * =============================================================================
 * @Roles(...) - declaring WHO may call a route
 * =============================================================================
 *     @Roles(Role.ADMIN)                 admins only
 *     @Roles(Role.ADMIN, Role.MANAGER)   either one (OR, not AND)
 *
 * Same mechanism as `@Public()`: `SetMetadata` writes, `Reflector` reads. That
 * pair is behind every custom decorator in Nest.
 *
 * WHY METADATA RATHER THAN AN `if` IN THE HANDLER?
 *   - It is DECLARATIVE and visible at a glance. You can read a controller and
 *     see the access policy without reading any method bodies - and so can a
 *     reviewer, and so can a script that audits which endpoints are admin-only.
 *   - It runs BEFORE the handler and before pipes, so an unauthorised caller
 *     never reaches your code and never has their body validated.
 *   - It is testable in isolation: the guard is a class with one method.
 *   - Express cannot do this. Middleware has no idea which handler it is about
 *     to run, so `checkRole('admin')` has to be a closure applied per route,
 *     with no way to enumerate the policy afterwards.
 *
 * SEMANTICS: multiple roles mean ANY of them (OR). If you need AND - "an admin
 * who has also verified their email" - that is a different concept
 * (permissions/claims), and stacking two guards expresses it better than
 * inventing a role called `admin_verified`. See the note on permissions in
 * `roles.guard.ts`.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
