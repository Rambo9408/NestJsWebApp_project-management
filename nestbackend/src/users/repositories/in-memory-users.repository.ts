import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PaginationQuery } from 'src/common/dto/pagination.query';

import { User } from '../entities/user.entity';
import { FindResult, NewUser, UserFilter, UsersRepository } from './users.repository';

/**
 * =============================================================================
 * The in-memory implementation - now a TEST DOUBLE, not the production store
 * =============================================================================
 * This was the only implementation in Phases 2-4. Phase 5 promotes MongoDB to
 * production and keeps this one for unit tests, where it earns its place:
 *
 *   - Service specs run with NO database, in milliseconds.
 *   - It is real code with real behaviour (uniqueness, sorting, pagination),
 *     not a pile of `jest.fn()` stubs that only assert you called a mock.
 *   - Because both implementations satisfy the same abstract class, a CONTRACT
 *     TEST can run against both - the same technique as the two password
 *     hashers in Phase 3, and the only reliable defence against a double that
 *     has quietly drifted from the real thing.
 *
 * WHAT IT IS NOT: a database. It dies with the process, it is per-instance so
 * two Node processes disagree, and it grows without bound. Those three
 * sentences are also the reason in-process caching breaks under horizontal
 * scaling (Phase 10).
 * =============================================================================
 */
@Injectable()
export class InMemoryUsersRepository extends UsersRepository {
  private readonly users = new Map<string, User>();

  /**
   * A secondary index, email -> id.
   *
   * Kept deliberately: without it `findByEmail` is a full scan, which is
   * exactly what MongoDB does on an unindexed field (a COLLSCAN). The Mongo
   * implementation gets the same thing from the unique index on `email`.
   */
  private readonly emailIndex = new Map<string, string>();

  create(data: NewUser): Promise<User> {
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      ...data,
      email: data.email.toLowerCase(),
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(user.id, user);
    this.emailIndex.set(user.email, user.id);

    return Promise.resolve({ ...user });
  }

  findById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    // Return a COPY: handing out the stored object would let a caller mutate
    // the "database" by accident - the in-memory equivalent of mutating a live
    // Mongoose document you forgot to `.lean()`.
    return Promise.resolve(user ? { ...user } : null);
  }

  findByIdWithSecrets(id: string): Promise<User | null> {
    // The in-memory store keeps everything on one object, so this is findById.
    // The distinction only exists because MongoDB projects the field away.
    return this.findById(id);
  }

  findByEmail(email: string): Promise<User | null> {
    const id = this.emailIndex.get(email.toLowerCase());
    return id ? this.findById(id) : Promise.resolve(null);
  }

  findAll(filter: UserFilter, pagination: PaginationQuery): Promise<FindResult<User>> {
    const matched = this.match(filter);

    // Stable ordering. An unordered list endpoint is a bug: without a sort,
    // pagination can show one record twice and skip another, because the
    // storage engine may return documents in any order.
    matched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const items = matched
      .slice(pagination.skip, pagination.skip + pagination.limit)
      .map((user) => ({ ...user }));

    return Promise.resolve({ items, total: matched.length });
  }

  update(id: string, patch: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User | null> {
    const existing = this.users.get(id);
    if (!existing) return Promise.resolve(null);

    if (patch.email && patch.email.toLowerCase() !== existing.email) {
      this.emailIndex.delete(existing.email);
      this.emailIndex.set(patch.email.toLowerCase(), id);
    }

    const updated: User = {
      ...existing,
      ...patch,
      email: (patch.email ?? existing.email).toLowerCase(),
      updatedAt: new Date(),
    };

    this.users.set(id, updated);
    return Promise.resolve({ ...updated });
  }

  remove(id: string): Promise<boolean> {
    const existing = this.users.get(id);
    if (!existing) return Promise.resolve(false);

    this.emailIndex.delete(existing.email);
    this.users.delete(id);
    return Promise.resolve(true);
  }

  count(filter: UserFilter = {}): Promise<number> {
    return Promise.resolve(this.match(filter).length);
  }

  private match(filter: UserFilter): User[] {
    const search = filter.search?.trim().toLowerCase();

    return [...this.users.values()].filter((user) => {
      if (filter.role && user.role !== filter.role) return false;
      if (!search) return true;
      return user.email.includes(search) || user.name.toLowerCase().includes(search);
    });
  }
}
