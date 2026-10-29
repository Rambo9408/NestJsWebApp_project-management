import { Role } from 'src/common/enums/role.enum';

/**
 * =============================================================================
 * ENTITY vs DTO vs SCHEMA - three words for three different jobs
 * =============================================================================
 * This trips people up constantly, and interviewers ask it precisely because
 * the answer reveals whether you have designed a real system.
 *
 *   ENTITY  (this file)   - the DOMAIN model. What a User *is* inside our
 *                           business logic. No HTTP concerns, no database
 *                           concerns. Services speak this language.
 *
 *   DTO     (dto/*.ts)    - the WIRE model. What crosses the HTTP boundary,
 *                           inbound (CreateUserDto) or outbound (UserResponse).
 *                           Validated on the way in, shaped on the way out.
 *
 *   SCHEMA  (Phase 5)     - the PERSISTENCE model. Mongoose field definitions,
 *                           indexes, hooks. What the database understands.
 *
 * WHY KEEP THEM SEPARATE when in a small app all three look almost identical?
 *
 *   1. SECURITY. The single most common data leak in Node APIs is returning the
 *      database document straight to the client - which ships `passwordHash`,
 *      `refreshTokenHash`, internal flags and soft-delete markers to anyone with
 *      a browser. A separate outbound type makes leaking a deliberate act
 *      rather than an oversight. Note `PublicUser` below.
 *
 *   2. COUPLING. If controllers return the Mongoose document, then renaming a
 *      database column is a BREAKING API CHANGE. With a mapping layer, the two
 *      evolve independently.
 *
 *   3. INPUT SAFETY. A DTO defines exactly which fields a client may set.
 *      Without one, `Object.assign(user, req.body)` lets a caller send
 *      `{"role":"admin"}` and promote themselves - mass assignment, a real and
 *      frequently exploited vulnerability. Phase 6's `whitelist: true` is the
 *      systematic fix.
 *
 * WHEN TO COLLAPSE THEM: for a small internal CRUD service, using the schema
 * class as the entity is a defensible shortcut - but keep the OUTBOUND type
 * separate regardless. That is the one that leaks secrets.
 *
 * TRADE-OFF: mapping code. It is boilerplate, and it is the cheapest insurance
 * in the codebase.
 * =============================================================================
 */
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;

  /**
   * NEVER leaves this process. Note the name: `passwordHash`, not `password`.
   * Naming the field for what it actually holds means a reviewer instantly
   * spots `user.password = req.body.password` as wrong.
   */
  passwordHash: string;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * The outbound projection: everything except the hash.
 *
 * `Omit<User, 'passwordHash'>` is doing real work here. If someone adds a
 * `twoFactorSecret` field to `User` and forgets to exclude it, this type will
 * happily include it - so Phase 6 pairs this with class-transformer's
 * `@Exclude()` for a belt-and-braces approach. For now, the mapping function
 * below is the single choke point through which users reach the outside world.
 */
export type PublicUser = Omit<User, 'passwordHash'>;

/**
 * The one place a User becomes public data.
 *
 * WHY A FUNCTION AND NOT A METHOD ON THE ENTITY? Because `User` is an interface
 * (a plain object at runtime), which keeps it trivially serialisable and easy
 * to build in tests. A class with methods would force every layer - the
 * database driver included - to reconstruct real instances. This is the
 * "anaemic domain model" trade-off: less object-oriented purity, far less
 * friction. For a system with genuinely rich invariants, a class with private
 * fields and behaviour is the better call.
 */
export function toPublicUser(user: User): PublicUser {
  // Deliberately explicit rather than `delete user.passwordHash` on a copy:
  // an allow-list cannot accidentally include a newly added secret field,
  // whereas a deny-list silently can.
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
