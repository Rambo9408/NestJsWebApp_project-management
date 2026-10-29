import {
  Body,
  Controller,
  UseGuards,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ProjectAccessGuard } from 'src/projects/guards/project-access.guard';
import { TaskAccessGuard } from './guards/task-access.guard';
import { ProjectsService } from 'src/projects/projects.service';
import { AuthenticatedUser } from 'src/auth/auth.types';
import { Role } from 'src/common/enums/role.enum';
import { CommentView } from 'src/comments/comments.repository';
import { Paginated } from 'src/common/dto/pagination.query';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';

import {
  AssignTaskDto,
  ChangeTaskStatusDto,
  CreateCommentDto,
  CreateTaskDto,
  ListTasksQuery,
  TaskStatsQuery,
  UpdateTaskDto,
} from './dto/task.dto';
import { ProjectTaskStats, TaskView, TaskWithAssignee } from './tasks.repository';
import { TasksService } from './tasks.service';

/**
 * =============================================================================
 * TasksController
 * =============================================================================
 *     POST   /api/v1/tasks
 *     GET    /api/v1/tasks?projectId&assigneeId&status&priority&search&overdue
 *     GET    /api/v1/tasks/stats?projectId=...     <- static path BEFORE :id
 *     GET    /api/v1/tasks/:id
 *     PATCH  /api/v1/tasks/:id
 *     PATCH  /api/v1/tasks/:id/status
 *     PATCH  /api/v1/tasks/:id/assignee
 *     DELETE /api/v1/tasks/:id
 *     GET    /api/v1/tasks/:id/comments
 *     POST   /api/v1/tasks/:id/comments
 *
 * NOTE THE ORDER of `stats` and `:id`. Declared the other way round,
 * `GET /tasks/stats` would match `:id` with `id === "stats"`, and with
 * `ParseObjectIdPipe` attached it would 400 with a message about ObjectIds -
 * confusing, and a real ten-minute debugging session for whoever hits it.
 *
 * PHASE 6 removed from this file: two `Object.values(...).includes(...)` enum
 * checks, an `overdue === 'true'` coercion, a required-parameter check, and the
 * `buildPaginationQuery` call. All of it is now declared on the query DTOs.
 * =============================================================================
 */
@ApiBearerAuth('access-token')
@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    // Injected to resolve the caller's project membership - the authorization
    // scope for the list endpoint below.
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Creating a task requires membership of the project named in the BODY.
   *
   * ProjectAccessGuard looks in params, body and query for a projectId - which
   * is what lets one guard serve route shapes as different as
   * POST /tasks { projectId } and GET /projects/:id/....
   */
  @UseGuards(ProjectAccessGuard)
  @Post()
  create(@Body() dto: CreateTaskDto, @CurrentUser('id') createdById: string): Promise<TaskView> {
    return this.tasksService.create(dto, createdById);
  }

  /**
   * ===========================================================================
   * LIST - SCOPED TO PROJECTS THE CALLER BELONGS TO
   * ===========================================================================
   * THE BUG THIS FIXES: this endpoint used to pass the query straight to the
   * repository with no membership constraint, so ANY authenticated user could
   * read EVERY task in the database. Reproduced before the fix: a brand-new
   * account with zero projects saw another user's three tasks.
   *
   * `POST /tasks` was already guarded by `ProjectAccessGuard` (it has a
   * projectId in the body to check). `GET /tasks` was not, because a list has
   * no id for a guard to check - and that asymmetry is exactly where
   * collection-level authorization gets forgotten.
   *
   * A LIST IS AUTHORIZED BY FILTERING, NOT BY A YES/NO GUARD. The scope is
   * derived from the token and passed to the repository as a constraint that
   * the caller cannot influence.
   * ===========================================================================
   */
  @Get()
  async findAll(
    @Query() query: ListTasksQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<TaskWithAssignee>> {
    /**
     * A GLOBAL ADMIN IS UNRESTRICTED - `undefined`, meaning "no scope".
     *
     * Everyone else gets the explicit list of projects they own or belong to.
     * If that list is EMPTY they see nothing, which is correct and is precisely
     * the case the repository's `!== undefined` check protects: treating `[]`
     * as "no filter" would restore the vulnerability for the users who should
     * see least.
     *
     * This matches `ProjectAccessGuard`'s own rule (`user.role === Role.ADMIN`
     * short-circuits), so a guarded item route and this list agree about what
     * admin means. Two places deciding that differently is its own bug class.
     */
    const accessibleProjectIds =
      user.role === Role.ADMIN
        ? undefined
        : await this.projectsService.findAccessibleProjectIds(user.id);

    return this.tasksService.findAll(
      {
        projectId: query.projectId,
        assigneeId: query.assigneeId,
        status: query.status,
        priority: query.priority,
        search: query.search,
        overdue: query.overdue,
        accessibleProjectIds,
      },
      query,
    );
  }

  /** Declared BEFORE `:id`. See the note above. */
  /**
   * GUARDED BY ProjectAccessGuard, not TaskAccessGuard - the projectId is in
   * the QUERY here, and that guard already reads params, body and query.
   *
   * Before the fix this returned per-status task counts for ANY project id,
   * which is a quiet but real leak: it reveals that a project exists and how
   * much work is in it.
   */
  @UseGuards(ProjectAccessGuard)
  @Get('stats')
  stats(@Query() query: TaskStatsQuery): Promise<ProjectTaskStats[]> {
    return this.tasksService.statsByProject(query.projectId);
  }

  @UseGuards(TaskAccessGuard)
  @Get(':id')
  findOne(@Param('id', ParseObjectIdPipe) id: string): Promise<TaskView> {
    return this.tasksService.findById(id);
  }

  @UseGuards(TaskAccessGuard)
  @Patch(':id')
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskView> {
    return this.tasksService.update(id, dto);
  }

  /**
   * A dedicated endpoint for the state transition rather than a generic PATCH,
   * because the transition carries its own rule (the conditional update) and
   * will carry its own authorization rule in Phase 8.
   */
  @UseGuards(TaskAccessGuard)
  @Patch(':id/status')
  changeStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ChangeTaskStatusDto,
  ): Promise<TaskView> {
    return this.tasksService.changeStatus(id, dto);
  }

  @UseGuards(TaskAccessGuard)
  @Patch(':id/assignee')
  assign(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AssignTaskDto,
  ): Promise<TaskView> {
    return this.tasksService.assign(id, dto);
  }

  /**
   * Returns a small body rather than 204, because "how many comments went with
   * it?" is genuinely useful after a cascading delete - and it is the visible
   * evidence that the transaction did both halves.
   */
  @UseGuards(TaskAccessGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<{ deletedComments: number }> {
    return this.tasksService.remove(id);
  }

  @UseGuards(TaskAccessGuard)
  @Get(':id/comments')
  listComments(
    @Param('id', ParseObjectIdPipe) taskId: string,
    @Query() query: ListTasksQuery,
  ): Promise<Paginated<CommentView>> {
    return this.tasksService.listComments(taskId, query);
  }

  /**
   * ===========================================================================
   * DELETE A COMMENT - nested under its task, which is where it belongs
   * ===========================================================================
   * Comments are already created and listed under `/tasks/:id/comments`. The
   * standalone `DELETE /comments/:id` was the odd one out, and that anomaly is
   * precisely what made it hard to authorize: a bare comment id gives you no
   * route to the project that owns the membership rule.
   *
   * Nesting it fixes both problems at once:
   *   - the URL is consistent with create and list
   *   - `TaskAccessGuard` establishes project membership from `:id` BEFORE the
   *     handler runs, so the service only has to decide the moderation rule
   *
   * NOTE it is NOT decorated with `@ProjectRoles(Role.MANAGER)`. Any member may
   * reach this route, because the AUTHOR of a comment is usually an ordinary
   * member deleting their own. The finer rule - author, or manager, or global
   * admin - needs the comment itself, so it lives in the service.
   *
   * That split is worth naming: a GUARD answers "may you touch this resource
   * at all?", and the SERVICE answers "may you do this particular thing to it?".
   * Pushing the second into a guard means loading the comment twice.
   * ===========================================================================
   */
  @UseGuards(TaskAccessGuard)
  @Delete(':id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeComment(
    @Param('id', ParseObjectIdPipe) taskId: string,
    @Param('commentId', ParseObjectIdPipe) commentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.tasksService.removeComment(taskId, commentId, actor);
  }

  @UseGuards(TaskAccessGuard)
  @Post(':id/comments')
  addComment(
    @Param('id', ParseObjectIdPipe) taskId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser('id') authorId: string,
  ): Promise<CommentView> {
    return this.tasksService.addComment(taskId, dto.body, authorId);
  }
}
