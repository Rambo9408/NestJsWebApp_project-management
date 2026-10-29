import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ActivityLogListener } from './activity-log.listener';
import { ActivityLogsController } from './activity-logs.controller';
import { ActivityLog, ActivityLogSchema } from './schemas/activity-log.schema';

/**
 * ActivityLogsModule.
 *
 * NOTE WHAT IT DOES NOT IMPORT: users, projects, tasks, comments. It records
 * events from all four and depends on none of them.
 *
 * That is the shape event-driven design produces, and it is worth pausing on:
 * this module was added AFTER every one of those features, and not one line of
 * their code changed. Compare with the direct-call version, where adding an
 * audit trail means editing four services and remembering to do it in the fifth.
 *
 * It is also the clearest possible microservice candidate (Phase 20) - it
 * already communicates only through events, which is exactly the boundary a
 * broker would sit on.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: ActivityLog.name, schema: ActivityLogSchema }])],
  controllers: [ActivityLogsController],
  providers: [ActivityLogListener],
})
export class ActivityLogsModule {}
