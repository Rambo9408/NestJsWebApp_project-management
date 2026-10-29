import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

import { Trim } from 'src/common/transforms/string.transforms';

import { PaginationQuery } from 'src/common/dto/pagination.query';

import { ProjectStatus } from '../entities/project.entity';

export class ListProjectsQuery extends PaginationQuery {
  @Trim()
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  /**
   * PHASE NOTE: today this is a client-supplied filter. After Phase 8 it stops
   * being either: a non-admin caller may only ever see their own projects, and
   * the id comes from the JWT. A filter that is really an authorization rule
   * must not be client-controlled - otherwise `?memberId=<someone-else>` is a
   * data leak with a friendly query-parameter name.
   */
  @IsMongoId()
  @IsOptional()
  memberId?: string;
}
