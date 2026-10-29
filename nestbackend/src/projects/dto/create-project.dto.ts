import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { Trim, TrimUpper } from 'src/common/transforms/string.transforms';

import { Role } from 'src/common/enums/role.enum';

/** Inbound contract for `POST /projects/:id/members`, and a nested item below. */
export class AddProjectMemberDto {
  /**
   * `@IsMongoId()` rejects a malformed id at the edge with 400, instead of
   * letting it reach Mongoose and become a `CastError` -> 500. Same job as
   * `ParseObjectIdPipe`, applied to a body field rather than a route param.
   */
  @IsMongoId()
  userId: string;

  /** The member's role WITHIN this project - not their global role. */
  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}

/**
 * =============================================================================
 * CreateProjectDto - and NESTED VALIDATION
 * =============================================================================
 */
export class CreateProjectDto {
  /**
   * `@Matches` with an anchored pattern. Note the ORDER of decorators does not
   * matter to class-validator (all rules run and all failures are collected),
   * but the order of `@Transform` vs validation DOES: transforms run first.
   */
  @TrimUpper()
  @IsString()
  @Length(2, 10)
  @Matches(/^[A-Z]+$/, { message: 'key must contain only letters, e.g. WEB' })
  key: string;

  @Trim()
  @IsString()
  @Length(3, 120)
  name: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  /**
   * PHASE 7 REMOVED  FROM THIS DTO.
   *
   * It used to be a body field. Now the owner is the AUTHENTICATED CALLER,
   * read from the JWT via @CurrentUser(). The rule that motivated the change:
   *
   *     Identity comes from the token, never from the payload.
   *
   * Any field that determines ownership or permission and is accepted from a
   * request body is a privilege-escalation vector - a client could create a
   * project owned by someone else, and once membership drives access, grant
   * themselves a way into another team data.
   */

  /**
   * ---------------------------------------------------------------------------
   * NESTED VALIDATION - the two decorators you must use together
   * ---------------------------------------------------------------------------
   *     @ValidateNested({ each: true })   validate each element's own rules
   *     @Type(() => AddProjectMemberDto)  tell class-transformer WHICH class
   *
   * WITHOUT `@Type()`, the array elements stay plain objects. class-validator
   * then has no metadata to check and SILENTLY PASSES anything. That is the
   * single most common validation hole in Nest applications: the DTO looks
   * validated, the nested payload is not, and `{ userId: { $ne: null } }` sails
   * through into a Mongo query.
   *
   * `@ArrayMaxSize` is not cosmetic either - without a bound, one request can
   * ask you to validate and insert a million members.
   */
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AddProjectMemberDto)
  @IsOptional()
  members?: AddProjectMemberDto[];
}
