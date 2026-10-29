import { BadRequestException } from '@nestjs/common';
import { SchemaOptions, Types } from 'mongoose';

/**
 * =============================================================================
 * Shared schema conventions
 * =============================================================================
 * Every collection in this project uses the same options. Defining them once
 * means a decision like "never leak `__v` to clients" is made in ONE place
 * instead of being re-remembered per schema - and the day it changes, it
 * changes once.
 * =============================================================================
 */
export const baseSchemaOptions: SchemaOptions = {
  /**
   * Mongoose maintains `createdAt` / `updatedAt` automatically.
   *
   * WHY NOT DO IT BY HAND? Because `updatedAt` is the field people forget on
   * exactly one update path, and then "sort by recently modified" is quietly
   * wrong. Let the driver own it.
   */
  timestamps: true,

  /**
   * `__v` is Mongoose's OPTIMISTIC CONCURRENCY counter, not noise.
   *
   * With `optimisticConcurrency: true` on a schema, a `save()` includes
   * `__v` in its filter and increments it. If another process saved in between,
   * the filter matches nothing and Mongoose throws `VersionError` - which is
   * how you detect a lost update instead of silently overwriting someone's
   * work. We keep the field, hide it from clients, and turn the check ON where
   * concurrent edits are realistic (see `task.schema.ts`).
   */
  versionKey: '__v',

  /**
   * STRIP filter fields that are not in the schema, instead of passing them to
   * MongoDB. A typo like `{ ownerid: x }` would otherwise match EVERY document
   * - a bug that reads as a data leak rather than a mistake.
   *
   * NOTE WHERE THIS LIVES: `strictQuery` is a MONGOOSE option, not a driver
   * connection option. Passing it in `MongooseModule.forRootAsync`'s options
   * hands it to the MongoDB driver, which rejects the whole connection with
   * `MongoParseError: option strictquery is not supported`. (I hit exactly
   * that while building this phase.) Schema options - or a global
   * `mongoose.set('strictQuery', true)` - are the correct home.
   */
  strictQuery: true,

  toJSON: {
    virtuals: true,
    /**
     * `_id` (an ObjectId) becomes `id` (a string), and internals are stripped.
     *
     * WHY: `_id` is a MongoDB detail. An API that exposes it has coupled its
     * public contract to its storage engine - and migrating to anything else
     * later becomes a breaking API change. `id` is also what every frontend
     * framework expects.
     *
     * NOTE this only applies to `toJSON()`. Our repositories use `.lean()`
     * (which bypasses documents entirely), so they map explicitly instead -
     * see `mapUser` and friends. Knowing that `lean()` skips getters,
     * virtuals AND toJSON transforms is a classic gotcha.
     */
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
};

/**
 * Convert a string to an ObjectId, or fail with 400 instead of 500.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: passing an arbitrary string where
 * Mongoose expects an ObjectId throws a `CastError`, which - with no exception
 * filter - surfaces as a 500 Internal Server Error. So a CLIENT's typo becomes
 * a SERVER error: your alerting fires, your error budget burns, and the metric
 * that says "we are broken" is lying.
 *
 * Phase 6 pushes this even earlier, to `@Param('id', ParseObjectIdPipe)`, so
 * the request is rejected before any service code runs. This helper is the
 * last line of defence for ids that arrive from somewhere else (a queue
 * payload, another service).
 */
export function toObjectId(value: string, field = 'id'): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new BadRequestException(`"${field}" must be a valid MongoDB ObjectId`);
  }
  return new Types.ObjectId(value);
}

/** Non-throwing variant, for optional filters where an invalid id just means "no match". */
export function toObjectIdOrNull(value?: string): Types.ObjectId | null {
  return value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

/**
 * MongoDB treats `$regex` input as a pattern, so a user searching for
 * `a.*b` or `(((` is either running an expensive scan or crashing the query.
 * Escaping turns user input back into a literal.
 *
 * THIS IS ALSO A DoS VECTOR, not just a correctness issue: a crafted pattern
 * like `(a+)+$` causes catastrophic backtracking. Escaping removes it.
 *
 * (The better answer for real search is a text index or a search engine -
 * see the note in `task.schema.ts`. Regex search does not scale.)
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Narrow a Mongoose result to a plain record for the mapping functions.
 *
 * WHY AN ASSERTION IS HONEST HERE: both `.lean()` and `.toObject()` return
 * plain JavaScript objects at runtime - the values genuinely are records. What
 * TypeScript objects to is only the missing INDEX SIGNATURE on Mongoose's
 * generated document type, which is a typing detail rather than a real
 * mismatch.
 *
 * Confining the assertion to one named helper is the point: `as unknown as X`
 * scattered through repositories is where type safety quietly dies, whereas one
 * function with a comment is auditable. If a mapper ever reads a field that
 * does not exist, that is a bug the mapper's own explicit casts should surface.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Stringify an id that may be an `ObjectId`, a string, or a populated document.
 *
 * WHY NOT JUST `String(value)`? Because after `.populate()` the field holds the
 * whole referenced DOCUMENT, and `String({...})` yields the literal
 * `"[object Object]"` - a populate bug that ships silently and only surfaces
 * when a client tries to use the id. ESLint's `no-base-to-string` rule flags it,
 * which is exactly the kind of warning worth keeping as an error rather than
 * silencing.
 */
export function idToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  /**
   * ORDER MATTERS HERE, and getting it wrong cost a debugging round while
   * writing this phase.
   *
   * The ObjectId check must come FIRST. BSON's `ObjectId` exposes an `_id`
   * accessor that returns ITSELF, so testing `'_id' in value` first sends this
   * function into infinite recursion - which surfaces as
   * `RangeError: Maximum call stack size exceeded` inside a 500, with a stack
   * naming nothing useful.
   *
   * A good reminder that duck typing on property NAMES is fragile: check the
   * most specific, behaviour-bearing member (`toHexString`) before a generic
   * structural one.
   */
  if (typeof value === 'object' && 'toHexString' in value) {
    return (value as { toHexString(): string }).toHexString();
  }

  // A populated document: use its own `_id`.
  if (typeof value === 'object' && '_id' in value) {
    return idToString(value._id);
  }

  return JSON.stringify(value);
}
