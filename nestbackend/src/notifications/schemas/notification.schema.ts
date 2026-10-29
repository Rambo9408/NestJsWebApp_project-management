import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { baseSchemaOptions } from 'src/database/schema.helpers';

export enum NotificationType {
  TASK_ASSIGNED = 'task_assigned',
  PROJECT_MEMBER_ADDED = 'project_member_added',
  COMMENT_ADDED = 'comment_added',
}

/**
 * A notification, persisted.
 *
 * WHY STORE THEM AT ALL when they are pushed in real time? Because a push is
 * best-effort by definition: the user was offline, the tab was closed, the
 * connection dropped mid-flight, or the process restarted between the write and
 * the publish. A notification that exists ONLY as a pushed event is a
 * notification that a reload loses.
 *
 * So the durable record is the source of truth and the stream is an optimisation
 * on top of it. That ordering also gives the client a simple, correct recovery
 * story: on connect, fetch the unread list; then apply the stream.
 */
@Schema({ ...baseSchemaOptions, collection: 'notifications' })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(NotificationType) })
  type: NotificationType;

  @Prop({ required: true, maxlength: 200 })
  title: string;

  @Prop({ default: '', maxlength: 1000 })
  body: string;

  /** Free-form context - the task id, the project key - for deep links. */
  @Prop({ type: Object, default: {} })
  meta: Record<string, unknown>;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;

export const NotificationSchema = SchemaFactory.createForClass(Notification);

/** "My unread notifications, newest first" - the query the bell icon makes. */
NotificationSchema.index(
  { userId: 1, createdAt: -1 },
  { partialFilterExpression: { readAt: null } },
);

/**
 * A TTL index: notifications expire after 90 days.
 *
 * WHY: this collection grows forever otherwise - one row per user per event,
 * and nobody reads a notification from last year. "Which collection is 400GB?"
 * is a real production question, and the answer is usually notifications, logs
 * or sessions with no expiry policy.
 *
 * `expireAfterSeconds` counts from the value in the field, so indexing
 * `createdAt` with 90 days gives exactly "delete 90 days after creation".
 */
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
