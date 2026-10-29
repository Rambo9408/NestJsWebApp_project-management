import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * =============================================================================
 * Shared pagination contract - now VALIDATED (Phase 6)
 * =============================================================================
 * Compare this file with its Phase 2 version. It used to contain a 15-line
 * `buildPaginationQuery()` helper doing three jobs by hand:
 *
 *     1. parse      Number.parseInt(rawPage ?? '', 10)
 *     2. default    Number.isInteger(page) && page > 0 ? page : 1
 *     3. clamp      Math.min(limit, MAX_PAGE_SIZE)
 *
 * All three are now DECLARATIVE, and the helper is gone. That is exactly what
 * pipes are for, and reading the two versions side by side is the fastest way
 * to understand why they exist.
 *
 * WHY A CLASS AND NOT AN INTERFACE? Decorators need a runtime object to attach
 * metadata to. Interfaces are erased, so class-validator, class-transformer and
 * the Swagger plugin all require a class - the same reflect-metadata mechanism
 * that powers dependency injection.
 * =============================================================================
 */

/** Hard ceiling so a client cannot request `?limit=1000000` and OOM the process. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export class PaginationQuery {
  /**
   * `@Type(() => Number)` is class-TRANSFORMER; the rest are class-VALIDATOR.
   * The distinction matters and is a common interview question:
   *
   *     class-transformer  converts the plain object into a typed instance
   *                        (string "2" -> number 2)
   *     class-validator    checks the resulting instance against the rules
   *
   * Order is transform THEN validate, which is why `@IsInt()` can be trusted:
   * without the transform it would fail for every request, because HTTP query
   * values are always strings.
   *
   * ALTERNATIVE: `ValidationPipe({ transform: true, transformOptions: {
   * enableImplicitConversion: true } })` infers the conversion from the
   * TypeScript type and lets you drop `@Type()`. It is convenient and it is
   * implicit - it will also happily coerce `"abc"` to `NaN` in some cases. This
   * project keeps `enableImplicitConversion` OFF and writes `@Type()`
   * explicitly, because explicit conversions are easier to reason about and to
   * review.
   */
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1)
  @IsOptional()
  page: number = 1;

  /**
   * `@Max(MAX_PAGE_SIZE)` REJECTS an oversized limit rather than silently
   * clamping it, which is a deliberate change from Phase 2's `Math.min`.
   *
   * WHY REJECT INSTEAD OF CLAMP? Because silently returning 100 items when the
   * client asked for 5000 makes the client believe it has everything - and
   * pagination bugs of that shape are extremely hard to spot. A 400 with
   * "limit must not be greater than 100" tells them the truth immediately.
   * (Clamping is defensible for a public API where you would rather not break
   * naive clients; know which one you chose and why.)
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  limit: number = DEFAULT_PAGE_SIZE;

  /**
   * Offset for the database driver. Kept here so the off-by-one lives in one
   * place.
   *
   * PERFORMANCE WARNING (Phase 19): offset pagination makes the database scan
   * and discard `skip` documents, so page 5000 is dramatically slower than page
   * 1. Correct for admin tables; wrong for infinite scroll, where cursor
   * pagination (`?after=<lastId>` + `_id > lastId`) is O(1) regardless of depth.
   */
  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/**
 * The response envelope for every list endpoint.
 *
 * `total` is what lets a client render "page 3 of 12" - and it is not free: it
 * requires a second `countDocuments()`. On huge collections that count can cost
 * more than the page itself, which is another argument for cursor pagination
 * (which omits it).
 */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Small helper so services do not re-derive `totalPages` five times. */
export function paginate<T>(items: T[], total: number, query: PaginationQuery): Paginated<T> {
  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: query.limit > 0 ? Math.ceil(total / query.limit) : 0,
  };
}
