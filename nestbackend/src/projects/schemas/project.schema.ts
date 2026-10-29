import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { Role } from 'src/common/enums/role.enum';
import { baseSchemaOptions } from 'src/database/schema.helpers';

import { ProjectStatus } from '../entities/project.entity';

/**
 * =============================================================================
 * EMBEDDED sub-document: project membership
 * =============================================================================
 * `_id: false` because these have no identity of their own - a membership is
 * identified by its (project, user) pair, not by a separate id.
 *
 * THE MODELLING DECISION: EMBED OR REFERENCE?
 * Membership is embedded in the project document rather than living in a
 * separate `memberships` collection. The rule of thumb:
 *
 *   EMBED when the child is owned by the parent, is read with it, and the
 *   array is BOUNDED. Reading a project gives you its members in one query
 *   with zero joins.
 *
 *   REFERENCE when the child has independent identity, is queried on its own,
 *   or the array is UNBOUNDED.
 *
 * "Bounded" is the operative word. MongoDB documents cap at 16MB, and - long
 * before that - an ever-growing array causes documents to be relocated on disk
 * and makes every read of the parent more expensive. Members-per-project is
 * naturally in the tens, so embedding is right. TASKS-per-project is unbounded,
 * which is exactly why tasks are a separate collection with a `projectId`
 * reference. Getting this backwards is the classic MongoDB modelling mistake -
 * usually described as the "massive array anti-pattern".
 * =============================================================================
 */
@Schema({ _id: false })
export class ProjectMemberSchemaClass {
  /**
   * `ref: 'User'` is what makes `.populate('members.userId')` work: it tells
   * Mongoose which model to look the id up in. Note the TYPE is `ObjectId`,
   * not `string` - storing ids as strings is a common and expensive mistake
   * (larger, and `$lookup`/populate against an ObjectId field silently matches
   * nothing).
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** The role WITHIN this project - independent of the user's global role. */
  @Prop({ required: true, enum: Object.values(Role), default: Role.MEMBER })
  role: Role;

  @Prop({ required: true, default: () => new Date() })
  joinedAt: Date;
}

export const ProjectMemberSchema = SchemaFactory.createForClass(ProjectMemberSchemaClass);

@Schema({ ...baseSchemaOptions, collection: 'projects' })
export class Project {
  /**
   * The human-readable key (`WEB`), unique across projects and used in task
   * references like `WEB-142`.
   *
   * `uppercase: true` normalises on write for the same reason `lowercase` does
   * on email: a unique index is only meaningful if the values are normalised.
   */
  @Prop({ required: true, unique: true, uppercase: true, trim: true, maxlength: 10 })
  key: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ default: '', trim: true, maxlength: 2000 })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  /**
   * `type: [ProjectMemberSchema]` - note it is the compiled SCHEMA, not the
   * class. Passing the class here is a frequent mistake and produces a
   * `Mixed` type with no validation at all.
   */
  @Prop({ type: [ProjectMemberSchema], default: [] })
  members: ProjectMemberSchemaClass[];

  @Prop({
    required: true,
    enum: Object.values(ProjectStatus),
    default: ProjectStatus.ACTIVE,
    index: true,
  })
  status: ProjectStatus;

  createdAt: Date;
  updatedAt: Date;
}

export type ProjectDocument = HydratedDocument<Project>;

export const ProjectSchema = SchemaFactory.createForClass(Project);

/**
 * "Projects this user can see", the single most common query in the app.
 *
 * A MULTIKEY INDEX: indexing a field inside an array makes MongoDB create one
 * index entry per array element. That is what lets `members.userId: X` be an
 * index lookup rather than a scan.
 *
 * ESR again - equality (`members.userId`, `status`) before sort (`createdAt`).
 *
 * THE CAVEAT WORTH KNOWING: you cannot create a compound index on TWO array
 * fields; MongoDB rejects it, because the number of index entries would be the
 * product of the array lengths. One array field per compound index.
 */
ProjectSchema.index({ 'members.userId': 1, status: 1, createdAt: -1 });

/**
 * A PARTIAL INDEX: only indexes documents matching the filter.
 *
 * "Active projects owned by X" is a frequent query, and most projects are
 * eventually archived. Indexing only the active ones keeps the index small -
 * which matters because indexes should stay in RAM. This is a cheap,
 * underused optimisation and a good thing to be able to name.
 */
ProjectSchema.index(
  { ownerId: 1, createdAt: -1 },
  { partialFilterExpression: { status: ProjectStatus.ACTIVE } },
);
