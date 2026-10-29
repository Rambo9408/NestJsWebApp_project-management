import { PaginationQuery } from 'src/common/dto/pagination.query';
import { Role } from 'src/common/enums/role.enum';

import { User } from '../entities/user.entity';

/** Everything callers may filter a user list by. */
export interface UserFilter {
  /** Case-insensitive substring match on name or email. */
  search?: string;
  role?: Role;
}

export interface FindResult<T> {
  items: T[];
  total: number;
}

/** What the caller supplies on create; the repository owns id and timestamps. */
export type NewUser = Omit<User, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * =============================================================================
 * THE REPOSITORY PORT - now an ABSTRACT CLASS, and that is deliberate
 * =============================================================================
 * Phase 2 had a single concrete `UsersRepository` holding a `Map`. Phase 5 needs
 * two implementations - MongoDB in production, in-memory in unit tests - so the
 * type and the implementation have to separate.
 *
 * WHY AN ABSTRACT CLASS RATHER THAN AN INTERFACE + STRING TOKEN?
 * Phase 3 used `interface PasswordHasher` + `PASSWORD_HASHER` and needed
 * `@Inject(PASSWORD_HASHER)` everywhere, because interfaces are erased. An
 * abstract class EXISTS AT RUNTIME, so it can be BOTH the type and the token:
 *
 *     { provide: UsersRepository, useClass: MongoUsersRepository }
 *     constructor(private readonly repo: UsersRepository) {}     // no @Inject
 *
 * This project now demonstrates both styles on purpose - they are the two
 * answers to the same interview question, and each is idiomatic:
 *
 *     interface + token   maximum decoupling; the contract is pure TypeScript,
 *                         with zero runtime footprint. Costs an @Inject at
 *                         every consumer.
 *     abstract class      ergonomic and refactor-friendly. Costs a real class
 *                         in the bundle, and you can only extend one.
 *
 * Rule of thumb: abstract class when it is YOUR abstraction inside your app
 * (like this); interface + token when the shape is external, or when several
 * unrelated contracts must be implemented by one object.
 *
 * WHY A REPOSITORY AT ALL, now that Mongoose exists? Same three reasons as
 * Phase 2, all of which get MORE true with a real database:
 *   - TESTABILITY: services unit-test against the in-memory implementation with
 *     no database and no `model.find().sort().skip().lean().exec()` mock chains.
 *   - LEAKAGE CONTROL: `$in`, `$regex` and aggregation pipelines stay here
 *     instead of spreading through business logic.
 *   - ONE PLACE FOR QUERY DISCIPLINE: projections, `.lean()`, index hints and
 *     pagination caps live in one file, so a performance fix is one diff.
 * =============================================================================
 */
export abstract class UsersRepository {
  abstract create(data: NewUser): Promise<User>;
  abstract findById(id: string): Promise<User | null>;
  abstract findByEmail(email: string): Promise<User | null>;

  /**
   * Like findById, but INCLUDING the password hash.
   *
   * Named so that its presence in a diff is conspicuous. The schema marks
   * passwordHash 'select: false', so the safe read is the default and this is
   * the deliberate opt-in - used only by the auth flow.
   */
  abstract findByIdWithSecrets(id: string): Promise<User | null>;
  abstract findAll(filter: UserFilter, pagination: PaginationQuery): Promise<FindResult<User>>;
  abstract update(id: string, patch: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User | null>;
  abstract remove(id: string): Promise<boolean>;
  abstract count(filter?: UserFilter): Promise<number>;
}
