import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { baseSchemaOptions } from 'src/database/schema.helpers';

/**
 * =============================================================================
 * ActivityLog - an append-only record of what happened
 * =============================================================================
 * This is the module that justifies the event bus. Without events, EVERY
 * service would have to remember to write an activity entry:
 *
 *     ProjectsService.addMember()   -> notify + log
 *     TasksService.create()          -> notify + log
 *     TasksService.changeStatus()    -> log
 *     CommentsService.create()       -> log
 *
 * Four services, four dependencies on the logger, and four places to forget it.
 * With a wildcard listener, ONE class subscribes to `*` and the feature services
 * do not know an audit log exists.
 *
 * That is the argument for event-driven design in one paragraph: the number of
 * places that must change when you add a cross-cutting reaction goes from N
 * to 1.
 * =============================================================================
 */
@Schema({ ...baseSchemaOptions, collection: 'activity_logs' })
export class ActivityLog {
  /** The event name, e.g. `task.status_changed`. */
  @Prop({ required: true, index: true })
  event: string;

  /** Who caused it. `system` for anything not triggered by a user. */
  @Prop({ required: true, index: true })
  actorId: string;

  /**
   * The thing acted upon, when there is one - a project id, a task id.
   *
   * Stored as a STRING rather than an ObjectId, deliberately: this collection
   * spans several entity types and `populate` across a polymorphic reference
   * does not work anyway. Keeping it opaque avoids implying a relationship the
   * schema cannot enforce.
   */
  /**
   * NOTE the explicit `type: String`.
   *
   * A union type (`string | null`) has no single runtime constructor, so the
   * reflected metadata is ambiguous and Mongoose refuses to guess:
   *
   *     Cannot determine a type for the "ActivityLog.subjectId" field
   *     (union/intersection/ambiguous type was used).
   *
   * A good error - and a reminder that @Prop reads the SAME emitted metadata
   * that dependency injection does (Phase 1), so it inherits the same limits.
   * Any nullable or union-typed property needs the type stated explicitly.
   */
  @Prop({ type: String, default: null, index: true })
  subjectId: string | null;

  /** The event payload, minus anything sensitive. See the listener. */
  @Prop({ type: Object, default: {} })
  payload: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export type ActivityLogDocument = HydratedDocument<ActivityLog>;

export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);

/** "What happened to this project/task, newest first" - the audit view. */
ActivityLogSchema.index({ subjectId: 1, createdAt: -1 });

/** "What has this user done" - the other question an audit log gets asked. */
ActivityLogSchema.index({ actorId: 1, createdAt: -1 });

/**
 * A TTL index: 180 days.
 *
 * An audit log is the collection most likely to grow without bound, and the one
 * people most often forget to bound. Note the TENSION worth being explicit
 * about: if the log exists for COMPLIANCE, a TTL may be illegal - some regimes
 * require years of retention. Retention is a product decision, not a technical
 * default, and the right move is to archive to cold storage before expiry
 * rather than to silently delete.
 */
ActivityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
