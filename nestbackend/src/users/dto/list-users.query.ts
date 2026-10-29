import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { Trim } from 'src/common/transforms/string.transforms';

import { PaginationQuery } from 'src/common/dto/pagination.query';
import { Role } from 'src/common/enums/role.enum';

/**
 * Query parameters for `GET /users`.
 *
 * INHERITANCE WORKS: extending `PaginationQuery` inherits its decorators, so
 * `page` and `limit` are validated here with no repetition. That is one of the
 * quiet advantages of class-based DTOs over ad-hoc interfaces.
 *
 * This replaces six loose `@Query('x') x?: string` parameters plus a manual
 * `Object.values(Role).includes(...)` check in the controller. The controller
 * is now three lines.
 */
export class ListUsersQuery extends PaginationQuery {
  @Trim()
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  /**
   * `@IsEnum(Role)` produces "role must be one of the following values: admin,
   * manager, member" - the same message the hand-written check produced, for
   * free, and it also feeds the OpenAPI schema in Phase 15.
   */
  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}
