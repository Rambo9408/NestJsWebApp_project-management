import { OmitType, PartialType } from '@nestjs/swagger';

import { CreateUserDto } from './create-user.dto';

/**
 * =============================================================================
 * UpdateUserDto - Phase 6 collapses this file to two lines
 * =============================================================================
 * It used to restate `email?`, `name?` and `role?` by hand. Now:
 *
 *     PartialType(T)          all fields optional, decorators preserved
 *     OmitType(T, [...])      everything except these
 *     PickType(T, [...])      only these
 *     IntersectionType(A, B)  merge two DTOs
 *
 * WHY MAPPED TYPES MATTER, beyond saving keystrokes: hand-copied DTOs DRIFT.
 * Add `@Length(2, 80)` to `CreateUserDto.name` and a hand-written update DTO
 * silently keeps the old rule, so the same field is validated differently
 * depending on the verb. `PartialType` copies the decorators, so that cannot
 * happen.
 *
 * WHY IMPORT FROM `@nestjs/swagger` AND NOT `@nestjs/mapped-types`?
 * The swagger version does everything the mapped-types version does AND carries
 * `@ApiProperty` metadata across, so Phase 15's generated documentation is
 * correct for free. If you are not using Swagger, `@nestjs/mapped-types` is the
 * lighter dependency. Using both in one project is a classic source of
 * "why is my field missing from the docs?".
 *
 * NOTE WHAT IS OMITTED: `password`. Changing a password is its own operation
 * with its own rules - require the current password, invalidate refresh tokens,
 * notify the user - so it gets its own endpoint in Phase 7 rather than riding
 * along in a generic PATCH. A field being technically updatable is not a reason
 * to put it in a generic update.
 * =============================================================================
 */
export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['password'] as const)) {}
