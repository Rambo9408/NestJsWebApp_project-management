import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CommentsModule } from 'src/comments/comments.module';
import { Counter, CounterSchema } from 'src/database/schemas/counter.schema';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { TaskAccessGuard } from './guards/task-access.guard';
import { UsersModule } from 'src/users/users.module';

import { Task, TaskSchema } from './schemas/task.schema';
import { TasksController } from './tasks.controller';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';

/**
 * TasksModule - the most connected feature module, and still acyclic.
 *
 *     TasksModule ──> ProjectsModule      (does this project exist? who is a member?)
 *                ──> UsersModule          (does this user exist?)
 *                ──> CommentsModule       (cascade delete inside a transaction)
 *                ──> NotificationsModule  (tell the assignee)
 *
 * Four dependencies and NO forwardRef anywhere, because every arrow points one
 * way. Compare with the Users/Projects cycle from Phase 4: the difference is
 * not luck, it is that each of these modules was given a single owner for the
 * question being asked.
 *
 * `Counter` is registered here rather than globally because tasks are the only
 * consumer of a sequence today. If a second one appears, it moves to
 * DatabaseModule - moving it later is a two-line change, guessing wrong now is
 * a permanent one.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    ProjectsModule,
    UsersModule,
    CommentsModule,
    NotificationsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, TasksRepository, TaskAccessGuard],
  exports: [TasksService],
})
export class TasksModule {}
