import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { Role } from 'src/common/enums/role.enum';
import { baseSchemaOptions } from 'src/database/schema.helpers';

/**
 * =============================================================================
 * SCHEMA vs MODEL vs DOCUMENT - the three words people mix up
 * =============================================================================
 *   SCHEMA   - the DEFINITION. Fields, types, validators, indexes, hooks.
 *              Knows nothing about a database connection.
 *   MODEL    - the schema COMPILED against a connection and bound to a
 *              collection. This is what you query: `userModel.find()`.
 *              It is what `@InjectModel(User.name)` gives you.
 *   DOCUMENT - a single RECORD returned by a model. A live object with
 *              `.save()`, getters, virtuals and change tracking.
 *
 * A useful analogy for interviews: schema = class definition, model = the
 * class bound to a table, document = an instance.
 *
 * And the fourth thing, which is why `.lean()` matters: a POJO. `.lean()`
 * skips document hydration entirely and returns plain objects - no `.save()`,
 * no virtuals, no `toJSON` transform, and roughly 3-5x faster with far less
 * memory. Use it for every read you are not going to mutate; that is most of
 * them.
 * =============================================================================
 *
 * WHY IS THIS SCHEMA A CLASS AND NOT A `new mongoose.Schema({...})`?
 * `@nestjs/mongoose`'s decorator syntax gives us one definition that TypeScript
 * can type-check, so `Model<User>` actually knows the fields. The plain
 * Mongoose object form requires a separate hand-written interface that WILL
 * drift from the schema. Same reflect-metadata mechanism as everything else in
 * Nest.
 */
@Schema({ ...baseSchemaOptions, collection: 'users' })
export class User {
  /**
   * `unique: true` is NOT a validator - it is an INDEX declaration.
   *
   * Three consequences worth being able to state:
   *   1. It is enforced by MongoDB, not by Mongoose, so it survives concurrent
   *      writes. The application-level `findByEmail` check in `UsersService`
   *      exists only to produce a friendly 409; THIS is the actual guarantee.
   *      "Validate in the app, enforce in the database."
   *   2. A violation surfaces as a driver error with `code: 11000`, not as a
   *      Mongoose ValidationError - so it must be caught and translated (see
   *      `mongo-users.repository.ts`), or clients get a 500 for a duplicate.
   *   3. On an existing collection with duplicates, the index BUILD fails.
   *      That is a deployment failure, not a code failure, and it is why index
   *      changes belong in migrations.
   *
   * `lowercase: true` normalises on write, so `Ada@x.com` and `ada@x.com`
   * cannot both exist. Note this makes the unique index meaningful - without
   * normalisation a "unique" email column is not unique in any way a human
   * cares about. (The rigorous alternative is a case-insensitive collation on
   * the index; normalising is simpler and loses nothing here.)
   */
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true, maxlength: 80 })
  name: string;

  /**
   * `select: false` means this field is EXCLUDED from every query result
   * unless explicitly asked for with `.select('+passwordHash')`.
   *
   * This is defence in depth, and it is the single most valuable line in this
   * file. Even if someone forgets the projection, forgets the DTO mapping, and
   * returns the raw document straight from a controller, the hash is not in it.
   * The default becomes safe; leaking becomes an explicit act.
   */
  @Prop({ required: true, select: false })
  passwordHash: string;

  /**
   * `enum` here is a Mongoose validator, so a document with `role: 'wizard'`
   * is rejected at write time. `index: true` because role appears in filters
   * ("list all admins") - and the moment a field is used in a WHERE clause on a
   * collection of any size, it needs an index or it is a collection scan.
   */
  @Prop({ required: true, enum: Object.values(Role), default: Role.MEMBER, index: true })
  role: Role;

  /**
   * Set by `timestamps: true` in baseSchemaOptions. Declared here so TypeScript
   * knows they exist - Mongoose adds them at runtime, but the compiler cannot
   * see that.
   */
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `HydratedDocument<User>` is the correct type for "a User document as returned
 * by a query": the schema fields PLUS `_id`, `save()`, `toJSON()`, etc.
 *
 * (The older `User & Document` intersection still appears in tutorials; the
 * hydrated form is what Mongoose 7+ recommends and it types `_id` correctly.)
 */
export type UserDocument = HydratedDocument<User>;

export const UserSchema = SchemaFactory.createForClass(User);

/**
 * -----------------------------------------------------------------------------
 * INDEXES declared outside the class
 * -----------------------------------------------------------------------------
 * Single-field indexes are convenient as `@Prop({ index: true })`. Compound
 * and partial indexes need the schema object, which is why they live here.
 *
 * THE COMPOUND INDEX RULE (ESR), the thing to actually remember:
 *
 *     Equality fields first, then Sort fields, then Range fields.
 *
 * Our list endpoint filters by `role` and sorts by `createdAt` descending, so
 * `{ role: 1, createdAt: -1 }` serves it from the index with no in-memory sort.
 *
 * WHY THE ORDER MATTERS: a compound index on `{ a, b }` can serve queries on
 * `a` and on `a + b`, but NOT on `b` alone - the "prefix rule". Getting the
 * order wrong means the index exists, looks reasonable in the schema, and is
 * never used. `.explain()` is how you find out.
 *
 * WHY NOT INDEX EVERYTHING: every index must be updated on every write, and it
 * consumes RAM (indexes should fit in memory or the point is lost). Indexes are
 * a read/write trade-off, not free speed.
 */
UserSchema.index({ role: 1, createdAt: -1 });

/**
 * A TEXT INDEX for the `?search=` filter.
 *
 * WHY: without it, "find users whose name contains X" is a regex scan over
 * every document - O(n), and unusable past a few thousand records.
 *
 * THE HONEST CAVEATS, because interviewers ask:
 *   - MongoDB allows only ONE text index per collection.
 *   - It matches whole words with stemming, NOT substrings. Searching "ada"
 *     will not find "Adalovelace". Real prefix/substring/typo search needs
 *     Atlas Search or a dedicated engine (Elasticsearch, Meilisearch).
 *   - Our repository still uses an escaped regex, because substring matching is
 *     what a small admin list actually wants. The index is here so the upgrade
 *     path is visible, and the trade-off is stated rather than hidden.
 */
UserSchema.index({ name: 'text', email: 'text' });
