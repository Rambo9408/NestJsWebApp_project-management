import { PartialType, PickType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { ToBoolean, Trim } from 'src/common/transforms/string.transforms';

import { PaginationQuery } from 'src/common/dto/pagination.query';

import { TaskPriority, TaskStatus } from '../schemas/task.schema';

export class CreateTaskDto {
  @Trim()
  @IsString()
  @Length(3, 200)
  title: string;

  @IsString()
  @MaxLength(5000)
  @IsOptional()
  description?: string;

  @IsMongoId()
  projectId: string;

  // PHASE 7 REMOVED : the creator is the authenticated caller.
  // Identity comes from the token, never from the payload.

  /**
   * `@ValidateIf` runs the following rules ONLY when the condition holds.
   *
   * Needed because `null` is MEANINGFUL here - it means "unassigned" - and
   * `@IsOptional()` would skip validation for `null` as well as `undefined`,
   * letting `""` or `0` through unchecked. `@ValidateIf(o => o.assigneeId !==
   * null)` keeps `null` legal while still validating any real value.
   *
   * This distinction (absent vs explicitly null) is exactly what PATCH bodies
   * get wrong, and it is worth being able to explain.
   */
  @ValidateIf((object: CreateTaskDto) => object.assigneeId !== null)
  @IsMongoId()
  @IsOptional()
  assigneeId?: string | null;

  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  /**
   * `@IsDateString()` validates an ISO-8601 STRING and leaves it a string; the
   * service converts to a `Date`.
   *
   * WHY NOT `@Type(() => Date)`? Because it accepts anything `new Date()`
   * accepts, including `"yesterday"` -> `Invalid Date`, which then silently
   * writes `null` or throws deep in the driver. Validating the FORMAT first and
   * converting explicitly afterwards fails loudly at the edge instead.
   */
  @ValidateIf((object: CreateTaskDto) => object.dueDate !== null)
  @IsDateString()
  @IsOptional()
  dueDate?: string | null;
}

/**
 * PATCH body. `PartialType(PickType(...))` keeps the rules in sync with
 * `CreateTaskDto` and deliberately excludes `projectId` (a task never moves
 * project - that would break its `WEB-142` reference) and `assigneeId` (which
 * has its own endpoint).
 */
export class UpdateTaskDto extends PartialType(
  PickType(CreateTaskDto, ['title', 'description', 'priority', 'dueDate'] as const),
) {}

/**
 * Status changes carry the CURRENT status the client believes the task is in,
 * so the update can be conditional and a concurrent change is DETECTED rather
 * than silently overwritten. Two people dragging the same card is a realistic
 * race, and "last write wins" quietly loses one person's work.
 *
 * This is optimistic concurrency expressed in the API contract - the same idea
 * as HTTP `If-Match` / ETag, which is the more standards-oriented alternative
 * if you want it uniformly across every endpoint.
 */
export class ChangeTaskStatusDto {
  @IsEnum(TaskStatus)
  from: TaskStatus;

  @IsEnum(TaskStatus)
  to: TaskStatus;
}

export class AssignTaskDto {
  /** `null` unassigns - see the @ValidateIf note above. */
  @ValidateIf((object: AssignTaskDto) => object.assigneeId !== null)
  @IsMongoId()
  assigneeId: string | null;
}

export class CreateCommentDto {
  @Trim()
  @IsString()
  @Length(1, 5000)
  body: string;

  // PHASE 7 REMOVED : the author is the authenticated caller.
}

export class ListTasksQuery extends PaginationQuery {
  @IsMongoId()
  @IsOptional()
  projectId?: string;

  @IsMongoId()
  @IsOptional()
  assigneeId?: string;

  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @Trim()
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  /**
   * HTTP has no booleans - `?overdue=true` arrives as the STRING "true".
   *
   * `@Type(() => Boolean)` is NOT enough on its own: `Boolean("false")` is
   * `true`, because any non-empty string is truthy. That trap catches people
   * constantly, so the conversion is explicit here.
   */
  @ToBoolean()
  @IsBoolean()
  @IsOptional()
  overdue?: boolean;
}

export class TaskStatsQuery {
  @IsMongoId()
  projectId: string;
}
