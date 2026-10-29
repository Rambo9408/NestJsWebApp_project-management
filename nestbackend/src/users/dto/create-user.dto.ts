import { IsEmail, IsEnum, IsOptional, IsString, Length } from 'class-validator';

import { Trim, TrimLower } from 'src/common/transforms/string.transforms';

import { Role } from 'src/common/enums/role.enum';
import { IsStrongPassword } from 'src/common/validators/is-strong-password.validator';

/**
 * =============================================================================
 * CreateUserDto - the inbound contract for POST /users
 * =============================================================================
 * PHASE 6: the decorators arrived, and every corresponding `if (!dto.email)
 * throw new BadRequestException(...)` was deleted from `UsersService`. Compare
 * the two commits and the argument for pipes makes itself.
 *
 * WHY A CLASS AND NOT AN INTERFACE? Decorators need a runtime object to attach
 * metadata to; interfaces are erased. Same reflect-metadata mechanism as
 * dependency injection.
 *
 * WHAT MAKES THE TYPE ANNOTATION TRUE AT RUNTIME:
 * In Phase 2, `@Body() dto: CreateUserDto` was a compile-time fiction - at
 * runtime the body was whatever the client sent. The global `ValidationPipe`
 * (registered via `APP_PIPE` in `app.module.ts`) is what changes that: it
 * constructs a real `CreateUserDto` instance with class-transformer, validates
 * it with class-validator, and rejects the request before the handler runs.
 * Believing the annotation WITHOUT the pipe is the single most dangerous
 * misconception a new Nest developer can have.
 * =============================================================================
 */
export class CreateUserDto {
  /**
   * `@Transform` runs BEFORE validation, so the value is normalised first.
   *
   * Trimming and lowercasing at the edge means the rest of the system never has
   * to think about `" Ada@Example.com "`. The schema lowercases too - belt and
   * braces, and the schema is what makes the unique index meaningful.
   */
  @TrimLower()
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;

  @Trim()
  @IsString()
  @Length(2, 80)
  name: string;

  /** Plaintext, received once over TLS, hashed immediately, never stored or logged. */
  @IsStrongPassword()
  password: string;

  /**
   * Optional. Defaults to MEMBER in the service.
   *
   * SECURITY NOTE: accepting a role from the request body is only safe because
   * Phase 8 puts `@Roles(Role.ADMIN)` on this endpoint. Self-registration
   * (Phase 7) must IGNORE this field and force MEMBER - otherwise anyone can
   * sign up as an admin. That is the single most common privilege-escalation
   * bug in tutorial-grade APIs, and `whitelist: true` alone does NOT prevent it,
   * because `role` IS on the allow-list here. The protection is the guard plus
   * a separate, narrower DTO for registration.
   */
  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}
