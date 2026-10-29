import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';

import { PaginationQuery } from 'src/common/dto/pagination.query';
import {
  asRecord,
  idToString,
  escapeRegex,
  toObjectId,
  toObjectIdOrNull,
} from 'src/database/schema.helpers';

import { Project, ProjectStatus } from '../entities/project.entity';
import { Project as ProjectSchemaClass, ProjectDocument } from '../schemas/project.schema';
import { NewProject, ProjectFilter, ProjectsRepository } from './projects.repository';

const DUPLICATE_KEY = 11000;

@Injectable()
export class MongoProjectsRepository extends ProjectsRepository {
  constructor(
    @InjectModel(ProjectSchemaClass.name)
    private readonly projectModel: Model<ProjectDocument>,
  ) {
    super();
  }

  async create(data: NewProject): Promise<Project> {
    try {
      const created = await this.projectModel.create({
        ...data,
        ownerId: toObjectId(data.ownerId, 'ownerId'),
        members: data.members.map((member) => ({
          ...member,
          userId: toObjectId(member.userId, 'members.userId'),
        })),
      });
      return mapProject(asRecord(created.toObject()));
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(`Project key "${data.key.toUpperCase()}" is already in use`);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Project | null> {
    const found = await this.projectModel.findById(toObjectId(id)).lean().exec();
    return found ? mapProject(found) : null;
  }

  async findByKey(key: string): Promise<Project | null> {
    const found = await this.projectModel.findOne({ key: key.toUpperCase() }).lean().exec();
    return found ? mapProject(found) : null;
  }

  async findAll(
    filter: ProjectFilter,
    pagination: PaginationQuery,
  ): Promise<{ items: Project[]; total: number }> {
    const query = this.buildFilter(filter);

    const [items, total] = await Promise.all([
      this.projectModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean()
        .exec(),
      this.projectModel.countDocuments(query).exec(),
    ]);

    return { items: items.map(mapProject), total };
  }

  async update(
    id: string,
    patch: Partial<Omit<Project, 'id' | 'createdAt'>>,
  ): Promise<Project | null> {
    const update: Record<string, unknown> = { ...patch };

    // Domain objects carry string ids; the collection stores ObjectIds. The
    // conversion belongs here, at the boundary - which is exactly why the
    // service never sees a Types.ObjectId.
    if (patch.members) {
      update.members = patch.members.map((member) => ({
        ...member,
        userId: toObjectId(member.userId, 'members.userId'),
      }));
    }

    const updated = await this.projectModel
      .findByIdAndUpdate(toObjectId(id), update, { new: true, runValidators: true })
      .lean()
      .exec();

    return updated ? mapProject(updated) : null;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.projectModel.deleteOne({ _id: toObjectId(id) }).exec();
    return result.deletedCount === 1;
  }

  /**
   * PHASE 4 pulled every project across the wire and filtered in JavaScript,
   * because the in-memory store had no owner filter. This is the same answer in
   * ONE round trip, with no documents transferred at all - and it is served by
   * the partial index `{ ownerId: 1, createdAt: -1 }` limited to active
   * projects.
   *
   * "Push the filter down to the database" is not a micro-optimisation; it is
   * the difference between O(1) and O(n) network traffic.
   */
  async countActiveOwnedBy(userId: string): Promise<number> {
    const ownerId = toObjectIdOrNull(userId);
    if (!ownerId) return 0;

    return this.projectModel.countDocuments({ ownerId, status: ProjectStatus.ACTIVE }).exec();
  }

  async findIdsForMember(userId: string): Promise<string[]> {
    const memberId = toObjectIdOrNull(userId);
    if (!memberId) return [];

    /**
     * `.select({ _id: 1 })` - project only the id. Fetching whole documents to
     * throw away every field but one is a classic and invisible waste; for a
     * user in 200 projects it is the difference between a few KB and a few
     * hundred.
     *
     * Same "owner OR member" shape as buildFilter, and it uses the same
     * multikey index on `members.userId`.
     */
    const documents = await this.projectModel
      .find({ $or: [{ ownerId: memberId }, { 'members.userId': memberId }] })
      .select({ _id: 1 })
      .lean()
      .exec();

    return documents.map((document) => String(document._id));
  }

  private buildFilter(filter: ProjectFilter): FilterQuery<ProjectDocument> {
    const query: FilterQuery<ProjectDocument> = {};

    if (filter.status) query.status = filter.status;

    const ownerId = toObjectIdOrNull(filter.ownerId);
    if (ownerId) query.ownerId = ownerId;

    const memberId = toObjectIdOrNull(filter.memberId);
    if (memberId) {
      /**
       * "Owner OR member". Note that `members.userId` matching relies on the
       * MULTIKEY index declared on the schema: indexing a field inside an array
       * produces one index entry per element, which is what makes this a lookup
       * instead of a scan.
       */
      query.$or = [{ ownerId: memberId }, { 'members.userId': memberId }];
    }

    if (filter.search?.trim()) {
      const safe = escapeRegex(filter.search.trim());
      const searchClause = [
        { name: { $regex: safe, $options: 'i' } },
        { key: { $regex: safe, $options: 'i' } },
      ];

      /**
       * TWO `$or` CLAUSES CANNOT COEXIST at the top level - the second
       * assignment would silently overwrite the first, and the membership
       * filter would vanish. That is a security bug, not a cosmetic one: the
       * caller would see projects they are not a member of.
       *
       * `$and` of two `$or`s is the correct composition. This is a small,
       * extremely common MongoDB mistake and worth recognising.
       */
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchClause }];
        delete query.$or;
      } else {
        query.$or = searchClause;
      }
    }

    return query;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === DUPLICATE_KEY
  );
}

function mapProject(document: Record<string, unknown>): Project {
  const members = (document.members ?? []) as Array<Record<string, unknown>>;

  return {
    id: idToString(document._id),
    key: document.key as string,
    name: document.name as string,
    description: (document.description as string) ?? '',
    ownerId: idToString(document.ownerId),
    members: members.map((member) => ({
      userId: idToString(member.userId),
      role: member.role as Project['members'][number]['role'],
      joinedAt: member.joinedAt as Date,
    })),
    status: document.status as ProjectStatus,
    createdAt: document.createdAt as Date,
    updatedAt: document.updatedAt as Date,
  };
}
