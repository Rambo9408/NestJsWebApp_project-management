import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { baseSchemaOptions } from 'src/database/schema.helpers';

/**
 * Comments on a task.
 *
 * Separate collection, again for the unbounded-array reason: a busy task can
 * accumulate hundreds of comments, and embedding them would make every task
 * read pay for all of them.
 *
 * It is also the reason `DELETE /tasks/:id` needs a TRANSACTION - deleting a
 * task must delete its comments, and two collections cannot be written
 * atomically without one. If comments were embedded, the delete would be a
 * single-document write and atomic for free. That is the trade-off, stated
 * plainly: references buy you unbounded growth and independent queries, and
 * cost you the free atomicity that embedding gives.
 */
@Schema({ ...baseSchemaOptions, collection: 'comments' })
export class Comment {
  @Prop({ required: true, trim: true, maxlength: 5000 })
  body: string;

  @Prop({ type: Types.ObjectId, ref: 'Task', required: true, index: true })
  taskId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  authorId: Types.ObjectId;

  /**
   * Soft-delete marker: comments are part of a conversation, and hard-deleting
   * one leaves replies referring to something that no longer exists.
   *
   * THE COST OF SOFT DELETES, stated honestly: every query must now remember
   * `deletedAt: null`, and the one that forgets shows deleted content. The
   * mitigation is to centralise the filter in the repository (which is what we
   * do) rather than trusting each call site - or to add a Mongoose query
   * middleware that applies it globally, at the price of making it invisible.
   */
  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type CommentDocument = HydratedDocument<Comment>;

export const CommentSchema = SchemaFactory.createForClass(Comment);

/**
 * "The comment thread for this task, oldest first."
 *
 * The partial filter means only live comments are indexed - so the index is
 * smaller AND the common query never has to filter deleted rows out of the
 * index scan.
 */
CommentSchema.index({ taskId: 1, createdAt: 1 }, { partialFilterExpression: { deletedAt: null } });
