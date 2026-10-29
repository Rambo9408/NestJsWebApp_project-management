import { PaginationQuery } from 'src/common/dto/pagination.query';

import { Project, ProjectStatus } from '../entities/project.entity';

export interface ProjectFilter {
  search?: string;
  status?: ProjectStatus;
  /** Projects this user owns or is a member of. */
  memberId?: string;
  /** Projects this user owns. */
  ownerId?: string;
}

export type NewProject = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * The projects port. Same reasoning as `UsersRepository` - an abstract class so
 * it serves as both the compile-time type and the runtime DI token.
 *
 * `countActiveOwnedBy` is new in Phase 5: Phase 4 implemented the "cannot delete
 * a user who owns projects" rule by loading every project and filtering in
 * JavaScript, because the in-memory store had no owner filter. That is an O(n)
 * scan pulled across the wire - fine for a Map, catastrophic for a collection.
 * The Mongo implementation answers it with a single `countDocuments` served by
 * the partial index on `{ ownerId, createdAt }`.
 *
 * The lesson generalises: pushing a filter down to the database is not a
 * micro-optimisation, it is the difference between O(1) network traffic and
 * O(n).
 */
export abstract class ProjectsRepository {
  abstract create(data: NewProject): Promise<Project>;
  abstract findById(id: string): Promise<Project | null>;
  abstract findByKey(key: string): Promise<Project | null>;
  abstract findAll(
    filter: ProjectFilter,
    pagination: PaginationQuery,
  ): Promise<{ items: Project[]; total: number }>;
  abstract update(
    id: string,
    patch: Partial<Omit<Project, 'id' | 'createdAt'>>,
  ): Promise<Project | null>;
  abstract remove(id: string): Promise<boolean>;
  abstract countActiveOwnedBy(userId: string): Promise<number>;

  /**
   * Every project id this user owns or belongs to.
   *
   * Deliberately UNPAGINATED and id-only. It is an authorization scope, not a
   * user-facing list - callers need the whole set to filter by, and a page of
   * it would silently under-scope. Ids only keeps the payload small even for a
   * user in hundreds of projects.
   */
  abstract findIdsForMember(userId: string): Promise<string[]>;
}
