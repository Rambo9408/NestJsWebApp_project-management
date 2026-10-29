import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PaginationQuery } from 'src/common/dto/pagination.query';

import { Project, ProjectStatus } from '../entities/project.entity';
import { NewProject, ProjectFilter, ProjectsRepository } from './projects.repository';

/** In-memory implementation - unit-test double only. See the users equivalent. */
@Injectable()
export class InMemoryProjectsRepository extends ProjectsRepository {
  private readonly projects = new Map<string, Project>();
  private readonly keyIndex = new Map<string, string>();

  create(data: NewProject): Promise<Project> {
    const now = new Date();
    const project: Project = {
      id: randomUUID(),
      ...data,
      key: data.key.toUpperCase(),
      createdAt: now,
      updatedAt: now,
    };

    this.projects.set(project.id, project);
    this.keyIndex.set(project.key, project.id);

    return Promise.resolve(this.clone(project));
  }

  findById(id: string): Promise<Project | null> {
    const project = this.projects.get(id);
    return Promise.resolve(project ? this.clone(project) : null);
  }

  findByKey(key: string): Promise<Project | null> {
    const id = this.keyIndex.get(key.toUpperCase());
    return id ? this.findById(id) : Promise.resolve(null);
  }

  findAll(
    filter: ProjectFilter,
    pagination: PaginationQuery,
  ): Promise<{ items: Project[]; total: number }> {
    const matched = this.match(filter);
    matched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const items = matched
      .slice(pagination.skip, pagination.skip + pagination.limit)
      .map((project) => this.clone(project));

    return Promise.resolve({ items, total: matched.length });
  }

  update(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<Project | null> {
    const existing = this.projects.get(id);
    if (!existing) return Promise.resolve(null);

    const updated: Project = { ...existing, ...patch, updatedAt: new Date() };
    this.projects.set(id, updated);
    return Promise.resolve(this.clone(updated));
  }

  remove(id: string): Promise<boolean> {
    const existing = this.projects.get(id);
    if (!existing) return Promise.resolve(false);

    this.keyIndex.delete(existing.key);
    this.projects.delete(id);
    return Promise.resolve(true);
  }

  countActiveOwnedBy(userId: string): Promise<number> {
    return Promise.resolve(this.match({ ownerId: userId, status: ProjectStatus.ACTIVE }).length);
  }

  findIdsForMember(userId: string): Promise<string[]> {
    return Promise.resolve(this.match({ memberId: userId }).map((project) => project.id));
  }

  private match(filter: ProjectFilter): Project[] {
    const search = filter.search?.trim().toLowerCase();

    return [...this.projects.values()].filter((project) => {
      if (filter.status && project.status !== filter.status) return false;
      if (filter.ownerId && project.ownerId !== filter.ownerId) return false;
      if (
        filter.memberId &&
        project.ownerId !== filter.memberId &&
        !project.members.some((member) => member.userId === filter.memberId)
      ) {
        return false;
      }
      if (!search) return true;
      return (
        project.name.toLowerCase().includes(search) || project.key.toLowerCase().includes(search)
      );
    });
  }

  /**
   * A DEEP-ish copy: `members` is an array of objects, so a shallow spread
   * would still hand out the live array and let a caller mutate the store.
   * Same class of bug as mutating a Mongoose document you forgot to `.lean()`,
   * or mutating an object pulled out of an in-process cache (Phase 10).
   */
  private clone(project: Project): Project {
    return { ...project, members: project.members.map((member) => ({ ...member })) };
  }
}
