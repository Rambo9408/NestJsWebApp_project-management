import { OmitType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { CreateUserDto } from 'src/users/dto/create-user.dto';

/**
 * =============================================================================
 * RegisterDto - and the most important two lines in this file
 * =============================================================================
 *     OmitType(CreateUserDto, ['role'])
 *
 * Self-registration MUST NOT accept a role. `CreateUserDto` has one because an
 * ADMIN creating a user legitimately chooses it; a stranger signing up does
 * not. Reusing `CreateUserDto` here would let anyone POST
 * `{"role":"admin"}` to a public endpoint and own the system.
 *
 * This is the single most common privilege-escalation bug in tutorial-grade
 * APIs, and note that `whitelist: true` does NOT save you - `role` IS on the
 * allow-list of `CreateUserDto`. The protection is a NARROWER DTO for the
 * public endpoint. Different audience, different contract.
 *
 * The general rule: one DTO per (operation, audience) pair, not one per entity.
 * =============================================================================
 */
export class RegisterDto extends OmitType(CreateUserDto, ['role'] as const) {}

export class LoginDto {
  @IsString()
  email: string;

  /**
   * NOTE: no `@IsStrongPassword()` here, deliberately.
   *
   * Login validates CREDENTIALS, not password policy. Applying the strength
   * rules would (a) reject users whose password predates a policy change, and
   * (b) leak the policy to anyone probing the endpoint. Validate the shape
   * minimally on login; enforce the policy where the password is SET.
   */
  @IsString()
  password: string;
}

export class RefreshDto {
  /**
   * Optional in the body, because the refresh token normally arrives in an
   * httpOnly cookie. The body form exists for non-browser clients (mobile,
   * CLI, service-to-service) which have no cookie jar.
   *
   * Supporting both is the pragmatic choice; the cookie is the SAFER one for
   * browsers - see the note in auth.controller.ts.
   */
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  newPassword: string;
}
