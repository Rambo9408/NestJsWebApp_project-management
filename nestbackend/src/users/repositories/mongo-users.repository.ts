import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';

import { PaginationQuery } from 'src/common/dto/pagination.query';
import { asRecord, idToString, escapeRegex, toObjectId } from 'src/database/schema.helpers';

import { User } from '../entities/user.entity';
import { User as UserSchemaClass, UserDocument } from '../schemas/user.schema';
import { FindResult, NewUser, UserFilter, UsersRepository } from './users.repository';

/** MongoDB's duplicate-key error code. Worth a named constant - it appears everywhere. */
const DUPLICATE_KEY = 11000;

/**
 * =============================================================================
 * The MongoDB implementation
 * =============================================================================
 * Everything Mongoose-specific is confined to this file. `UsersService` has no
 * idea any of it exists - which is what makes the swap in `users.module.ts` a
 * one-line change and what would make a future move to another store a
 * one-file change.
 * =============================================================================
 */
@Injectable()
export class MongoUsersRepository extends UsersRepository {
  /**
   * `@InjectModel(User.name)` resolves the token that
   * `MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])`
   * registered in this module.
   *
   * MECHANICALLY it is just `@Inject(getModelToken('User'))` - the model is an
   * ordinary custom provider under a string token
   * (`'UserModel'`). That is why a test can replace it with
   * `{ provide: getModelToken(User.name), useValue: fake }`, and it is a good
   * demonstration that the framework's own conveniences are built from the same
   * primitives as Phase 3.
   */
  constructor(@InjectModel(UserSchemaClass.name) private readonly userModel: Model<UserDocument>) {
    super();
  }

  async create(data: NewUser): Promise<User> {
    try {
      const created = await this.userModel.create(data);
      return mapUser(asRecord(created.toObject()));
    } catch (error) {
      /**
       * TRANSLATE THE DUPLICATE-KEY ERROR.
       *
       * `UsersService` checks for an existing email first, but that check is
       * check-then-act and therefore racy: two simultaneous registrations can
       * both pass it. The unique index is the real guarantee - and when it
       * fires, the driver throws a `MongoServerError` with `code: 11000`, which
       * would otherwise surface as a 500.
       *
       * So the pattern is: application check for a FRIENDLY message, database
       * index for the GUARANTEE, and this translation so the guarantee still
       * produces a 409 rather than an incident.
       */
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<User | null> {
    /**
     * `.lean()` returns a PLAIN OBJECT instead of a hydrated Mongoose document:
     * no `save()`, no virtuals, no `toJSON` transform - and roughly 3-5x faster
     * with far less memory, because hydration is the expensive part.
     *
     * Use it for every read you are not going to mutate. That is most reads.
     * The trap is that `lean()` also skips the `toJSON` transform, which is why
     * this file maps `_id` to `id` by hand in `mapUser`.
     *
     * `.select('+passwordHash')` is NOT used here: the schema marks that field
     * `select: false`, so the default is safe and only the auth path opts in.
     */
    const found = await this.userModel.findById(toObjectId(id)).lean().exec();
    return found ? mapUser(found) : null;
  }

  async findByIdWithSecrets(id: string): Promise<User | null> {
    const found = await this.userModel
      .findById(toObjectId(id))
      .select('+passwordHash')
      .lean()
      .exec();

    return found ? mapUser(found) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    /**
     * The ONE place that opts into the password hash, used by `AuthModule`
     * (Phase 7) to verify a login. Every other read leaves it behind.
     *
     * Note `email` is lowercased on write by the schema, so this lookup is
     * exact and hits the unique index. Searching with a case-insensitive regex
     * instead would ignore that index entirely - a very common performance bug.
     */
    const found = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .lean()
      .exec();

    return found ? mapUser(found) : null;
  }

  async findAll(filter: UserFilter, pagination: PaginationQuery): Promise<FindResult<User>> {
    const query = this.buildFilter(filter);

    /**
     * TWO QUERIES, RUN CONCURRENTLY.
     *
     * A paginated list needs the page AND the total. Running them with
     * `Promise.all` costs one round trip instead of two - a trivial change that
     * halves the latency of every list endpoint in the application.
     *
     * The honest caveat: `countDocuments` on a large collection with a
     * selective filter can cost MORE than the page itself, because it must
     * examine every match. That is one of the strongest arguments for CURSOR
     * pagination, which needs no total at all (Phase 19).
     */
    const [items, total] = await Promise.all([
      this.userModel
        .find(query)
        // ESR: this sort is served by the { role: 1, createdAt: -1 } index when
        // `role` is in the filter. Without an index, MongoDB sorts in memory
        // and ABORTS past 32MB with "Sort exceeded memory limit" - a failure
        // that only ever appears in production, on the largest collection.
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean()
        .exec(),
      this.userModel.countDocuments(query).exec(),
    ]);

    return { items: items.map(mapUser), total };
  }

  async update(id: string, patch: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User | null> {
    try {
      /**
       * `findByIdAndUpdate` with `new: true` returns the document AFTER the
       * update. Without it you get the pre-update version, which is a
       * genuinely confusing bug ("my API returns the old value").
       *
       * `runValidators: true` is also not the default: schema validators such
       * as `enum` and `maxlength` are NOT applied to update operations unless
       * you ask. Plenty of production data has been corrupted through that gap.
       */
      const updated = await this.userModel
        .findByIdAndUpdate(toObjectId(id), patch, { new: true, runValidators: true })
        .lean()
        .exec();

      return updated ? mapUser(updated) : null;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.userModel.deleteOne({ _id: toObjectId(id) }).exec();
    return result.deletedCount === 1;
  }

  async count(filter: UserFilter = {}): Promise<number> {
    /**
     * `countDocuments` scans matching documents. `estimatedDocumentCount` reads
     * collection metadata and is O(1) - but ignores filters and can be stale
     * after an unclean shutdown. Use the estimate for "roughly how many users
     * do we have" dashboards, never for pagination arithmetic.
     */
    return this.userModel.countDocuments(this.buildFilter(filter)).exec();
  }

  private buildFilter(filter: UserFilter): FilterQuery<UserDocument> {
    const query: FilterQuery<UserDocument> = {};

    if (filter.role) query.role = filter.role;

    if (filter.search?.trim()) {
      /**
       * `escapeRegex` turns user input back into a literal.
       *
       * Without it, `?search=(((`  is a syntax error and `?search=(a+)+$` is a
       * catastrophic-backtracking DoS. It is also, strictly, NoSQL injection:
       * unescaped user input reaching a query operator.
       *
       * PERFORMANCE HONESTY: a non-anchored `$regex` cannot use an index, so
       * this is a collection scan. It is fine for an admin user list; it is not
       * fine for a large public search, which needs a text index (declared on
       * the schema) or a real search engine. Stating that trade-off out loud is
       * the senior answer - "I used regex, and here is the threshold at which I
       * would replace it".
       */
      const safe = escapeRegex(filter.search.trim());
      query.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { email: { $regex: safe, $options: 'i' } },
      ];
    }

    return query;
  }
}

/** Narrow an unknown error to MongoDB's duplicate-key shape. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === DUPLICATE_KEY
  );
}

/**
 * Document -> domain entity.
 *
 * WHY MAP AT ALL, when the shapes are nearly identical?
 *   - `_id` (ObjectId) becomes `id` (string). The API contract must not be
 *     coupled to the storage engine's identifier type.
 *   - `__v` and any future internal field never escape this layer.
 *   - The domain type stays a plain object, so services and tests never depend
 *     on Mongoose being loaded.
 * The cost is boilerplate. It is the cheapest insurance in the codebase.
 */
function mapUser(document: Record<string, unknown>): User {
  return {
    id: idToString(document._id),
    email: document.email as string,
    name: document.name as string,
    role: document.role as User['role'],
    // Absent whenever the caller did not opt in via `.select('+passwordHash')`.
    passwordHash: (document.passwordHash as string) ?? '',
    createdAt: document.createdAt as Date,
    updatedAt: document.updatedAt as Date,
  };
}
