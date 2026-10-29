import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';

import { PaginationQuery } from 'src/common/dto/pagination.query';
import { asRecord, idToString, toObjectId } from 'src/database/schema.helpers';

import { Comment, CommentDocument } from './schemas/comment.schema';

export interface CommentView {
  id: string;
  body: string;
  taskId: string;
  authorId: string;
  author: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CommentsRepository {
  constructor(@InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>) {}

  async create(data: { body: string; taskId: string; authorId: string }): Promise<CommentView> {
    const created = await this.commentModel.create({
      body: data.body,
      taskId: toObjectId(data.taskId, 'taskId'),
      authorId: toObjectId(data.authorId, 'authorId'),
    });

    return mapComment(asRecord(created.toObject()));
  }

  async findByTask(
    taskId: string,
    pagination: PaginationQuery,
  ): Promise<{ items: CommentView[]; total: number }> {
    /**
     * `deletedAt: null` is applied HERE, in the repository, and nowhere else.
     *
     * That is the mitigation for the main cost of soft deletes: every query has
     * to remember the filter, and the one that forgets shows deleted content.
     * Centralising it means there is one place to be right.
     *
     * It also matches the partial index on the schema exactly, so this query is
     * served entirely from a small index.
     */
    const query = { taskId: toObjectId(taskId, 'taskId'), deletedAt: null };

    const [items, total] = await Promise.all([
      this.commentModel
        .find(query)
        .sort({ createdAt: 1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate({ path: 'authorId', select: 'name' })
        .lean()
        .exec(),
      this.commentModel.countDocuments(query).exec(),
    ]);

    return { items: items.map(mapComment), total };
  }

  async findById(id: string): Promise<CommentView | null> {
    const found = await this.commentModel
      .findOne({ _id: toObjectId(id), deletedAt: null })
      .lean()
      .exec();

    return found ? mapComment(found) : null;
  }

  /** Soft delete: the row stays, the thread stays readable, the content goes. */
  async softDelete(id: string): Promise<boolean> {
    const result = await this.commentModel
      .updateOne({ _id: toObjectId(id), deletedAt: null }, { $set: { deletedAt: new Date() } })
      .exec();

    return result.modifiedCount === 1;
  }

  /**
   * HARD delete of every comment on a task - used only by the task-deletion
   * transaction.
   *
   * `deleteMany` inside a session is one operation, so this scales to a task
   * with thousands of comments without N round trips. Note it must be given the
   * session or it runs outside the transaction and will not roll back.
   */
  async removeByTask(taskId: string, session?: ClientSession): Promise<number> {
    const result = await this.commentModel
      .deleteMany({ taskId: toObjectId(taskId, 'taskId') })
      .session(session ?? null)
      .exec();

    return result.deletedCount;
  }

  async countByTask(taskId: string): Promise<number> {
    return this.commentModel
      .countDocuments({ taskId: toObjectId(taskId, 'taskId'), deletedAt: null })
      .exec();
  }
}

function mapComment(document: Record<string, unknown>): CommentView {
  const populated = document.authorId as Record<string, unknown> | null;
  const isPopulated = populated !== null && typeof populated === 'object' && 'name' in populated;

  return {
    id: idToString(document._id),
    body: document.body as string,
    taskId: idToString(document.taskId),
    authorId: isPopulated ? idToString(populated._id) : idToString(document.authorId),
    author: isPopulated ? { id: idToString(populated._id), name: populated.name as string } : null,
    createdAt: document.createdAt as Date,
    updatedAt: document.updatedAt as Date,
  };
}
