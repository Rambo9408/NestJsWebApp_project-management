import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { IsMongoId, IsOptional, IsString } from 'class-validator';
import { Model } from 'mongoose';

import { Roles } from 'src/common/decorators/roles.decorator';
import { Paginated, PaginationQuery, paginate } from 'src/common/dto/pagination.query';
import { Role } from 'src/common/enums/role.enum';
import { asRecord, idToString } from 'src/database/schema.helpers';

import { ActivityLog, ActivityLogDocument } from './schemas/activity-log.schema';

class ListActivityQuery extends PaginationQuery {
  /** Filter to one project, task or user. */
  @IsMongoId()
  @IsOptional()
  subjectId?: string;

  @IsString()
  @IsOptional()
  event?: string;
}

export interface ActivityLogView {
  id: string;
  event: string;
  actorId: string;
  subjectId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/**
 * The audit view.
 *
 * ADMIN-ONLY, and that is not a default - it is the point. An activity log
 * aggregates who did what across every project, so exposing it broadly would
 * leak more than any individual endpoint does: a member could learn which
 * projects exist, who joined them and when, purely by reading the log.
 *
 * The general rule worth stating: an aggregate view needs its own authorization
 * decision, because "the user can see each of these individually" does not
 * imply "the user can see all of them together".
 */
@Roles(Role.ADMIN)
@ApiBearerAuth('access-token')
@ApiTags('activity-logs')
@Controller('activity-logs')
export class ActivityLogsController {
  constructor(
    @InjectModel(ActivityLog.name)
    private readonly activityLogModel: Model<ActivityLogDocument>,
  ) {}

  @Get()
  async findAll(@Query() query: ListActivityQuery): Promise<Paginated<ActivityLogView>> {
    const filter: Record<string, unknown> = {};
    if (query.subjectId) filter.subjectId = query.subjectId;
    if (query.event) filter.event = query.event;

    const [items, total] = await Promise.all([
      this.activityLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.activityLogModel.countDocuments(filter).exec(),
    ]);

    return paginate(
      items.map((item) => mapActivity(asRecord(item))),
      total,
      query,
    );
  }
}

function mapActivity(document: Record<string, unknown>): ActivityLogView {
  return {
    id: idToString(document._id),
    event: document.event as string,
    actorId: document.actorId as string,
    subjectId: (document.subjectId as string) ?? null,
    payload: (document.payload as Record<string, unknown>) ?? {},
    createdAt: document.createdAt as Date,
  };
}
