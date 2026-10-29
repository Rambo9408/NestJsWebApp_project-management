import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { PaginationQuery } from 'src/common/dto/pagination.query';
import { asRecord, idToString, toObjectId } from 'src/database/schema.helpers';

import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';

export interface NotificationView {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async create(data: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    meta?: Record<string, unknown>;
  }): Promise<NotificationView> {
    const created = await this.notificationModel.create({
      userId: toObjectId(data.userId, 'userId'),
      type: data.type,
      title: data.title,
      body: data.body,
      meta: data.meta ?? {},
    });

    return mapNotification(asRecord(created.toObject()));
  }

  async findForUser(
    userId: string,
    pagination: PaginationQuery,
    unreadOnly: boolean,
  ): Promise<{ items: NotificationView[]; total: number }> {
    const query = {
      userId: toObjectId(userId, 'userId'),
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [items, total] = await Promise.all([
      this.notificationModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean()
        .exec(),
      this.notificationModel.countDocuments(query).exec(),
    ]);

    return { items: items.map((item) => mapNotification(asRecord(item))), total };
  }

  /**
   * Mark one notification read - but only if it belongs to the caller.
   *
   * NOTE `userId` IS IN THE FILTER, not checked afterwards. That is the
   * difference between an authorization check and an authorization
   * GUARANTEE: a filter cannot be forgotten by a later refactor, and it makes
   * the "not mine" and "does not exist" cases indistinguishable to the caller -
   * which is the right leak profile, exactly as in `ProjectAccessGuard`.
   *
   * This is IDOR (insecure direct object reference) defence, and doing it in
   * the query is the cheapest possible version.
   */
  async markRead(id: string, userId: string): Promise<boolean> {
    const result = await this.notificationModel
      .updateOne(
        { _id: toObjectId(id), userId: toObjectId(userId, 'userId'), readAt: null },
        { $set: { readAt: new Date() } },
      )
      .exec();

    return result.matchedCount === 1;
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.notificationModel
      .updateMany(
        { userId: toObjectId(userId, 'userId'), readAt: null },
        { $set: { readAt: new Date() } },
      )
      .exec();

    return result.modifiedCount;
  }

  countUnread(userId: string): Promise<number> {
    // Served entirely by the partial index on { userId, createdAt } filtered to
    // `readAt: null` - so the bell-icon badge costs an index scan, not a
    // collection scan.
    return this.notificationModel
      .countDocuments({ userId: toObjectId(userId, 'userId'), readAt: null })
      .exec();
  }
}

function mapNotification(document: Record<string, unknown>): NotificationView {
  return {
    id: idToString(document._id),
    userId: idToString(document.userId),
    type: document.type as NotificationType,
    title: document.title as string,
    body: (document.body as string) ?? '',
    meta: (document.meta as Record<string, unknown>) ?? {},
    readAt: (document.readAt as Date) ?? null,
    createdAt: document.createdAt as Date,
  };
}
