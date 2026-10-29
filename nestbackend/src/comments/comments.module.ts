import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { UsersModule } from 'src/users/users.module';

import { CommentsController } from './comments.controller';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { Comment, CommentSchema } from './schemas/comment.schema';

/**
 * CommentsModule.
 *
 * It exports BOTH the service and the repository, which is unusual for this
 * project and is a deliberate exception worth justifying:
 *
 *   - `CommentsService` is the normal public API.
 *   - `CommentsRepository` is exported ONLY so `TasksService` can delete
 *     comments inside the same MongoDB session during a cascading delete.
 *     A transaction needs every write to share one session, and a service
 *     method that hides the session cannot participate.
 *
 * That is the honest trade-off of transactions across aggregates: they force
 * you to widen a module boundary. The alternatives are to embed comments in the
 * task document (atomic for free, but unbounded growth) or to accept eventual
 * consistency and clean up orphans with a background job (Phase 12). All three
 * are defensible; pretending there is no cost is not.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Comment.name, schema: CommentSchema }]),
    UsersModule,
  ],
  controllers: [CommentsController],
  providers: [CommentsService, CommentsRepository],
  exports: [CommentsService, CommentsRepository],
})
export class CommentsModule {}
