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
import { AuthenticatedUser } from 'src/auth/auth.types';
import { Role } from 'src/common/enums/role.enum';
import { Paginated } from 'src/common/dto/pagination.query';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';

import { AddProjectMemberDto, CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsQuery } from './dto/list-projects.query';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Project } from './entities/project.entity';
import { ProjectAccessGuard, ProjectRoles } from './guards/project-access.guard';
import { ProjectsService } from './projects.service';

/**
 * =============================================================================
 * ProjectsController
 * =============================================================================
 *     POST   /api/v1/projects
 *     GET    /api/v1/projects
 *     GET    /api/v1/projects/:id
 *     PATCH  /api/v1/projects/:id
 *     POST   /api/v1/projects/:id/archive
 *     POST   /api/v1/projects/:id/members
 *     DELETE /api/v1/projects/:id/members/:userId
 *
 * NESTED ROUTES: `/projects/:id/members` reads as "the members OF this project",
 * which makes the relationship part of the URL and gives the endpoint an obvious
 * place to enforce "may the caller touch THIS project?" (Phase 8).
 *
 * Nest a maximum of one level. `/projects/:id/tasks/:tid/comments/:cid` is a URL
 * nobody builds correctly; once a resource has its own identifier, give it a
 * top-level route and use query parameters for filtering.
 *
 * ROUTE ORDER: Nest registers routes in DECLARATION order and Express matches
 * the first fit, so a static segment must be declared before a conflicting
 * parameter (`@Get('archived')` before `@Get(':id')`).
 * =============================================================================
 */
@ApiBearerAuth('access-token')
@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(
    @Body() dto: CreateProjectDto,
    // The owner is the AUTHENTICATED caller, not a body field. See the note in
    // create-project.dto.ts: identity comes from the token, never the payload.
    @CurrentUser('id') ownerId: string,
  ): Promise<Project> {
    return this.projectsService.create(dto, ownerId);
  }

  /**
   * ===========================================================================
   * LIST - SCOPED TO THE CALLER. This is an authorization boundary.
   * ===========================================================================
   * THE BUG THIS FIXES: `memberId` used to be taken straight from the query
   * string, so omitting it returned EVERY project in the database. A brand-new
   * user with no projects could read the entire organisation's project list.
   *
   * That is BROKEN OBJECT-LEVEL AUTHORIZATION (OWASP API1), and the shape of
   * the mistake is worth recognising because it is extremely common:
   *
   *     GET /projects/:id   was guarded by ProjectAccessGuard   ✓
   *     GET /projects       was not guarded at all              ✗
   *
   * Guarding the item route feels like the job is done - but a collection
   * endpoint ENUMERATES the very things the item guard protects. A guard on
   * `/:id` stops you reading one project you should not see; it does nothing
   * about a list that hands you all of them.
   *
   * WHY A GUARD WOULD NOT WORK HERE, and this is the interesting part:
   * `ProjectAccessGuard` answers "may this user touch THIS project?" and needs
   * an id from the route. A list has no id. Collection authorization is not a
   * yes/no decision - it is a FILTER, and a filter has to live in the query.
   *
   * So the rule is: scope the query by identity from the TOKEN, never from a
   * client-supplied parameter.
   *
   * INTERVIEW: "you guarded /:id - why is the list still a problem?" This is
   * the answer, and it separates people who have thought about authorization
   * from people who have added a guard.
   * ===========================================================================
   */
  @Get()
  findAll(
    @Query() query: ListProjectsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<Project>> {
    /**
     * A GLOBAL ADMIN SEES EVERYTHING, and may narrow with `?memberId=` - which
     * is a legitimate support tool ("show me Ada's projects").
     *
     * EVERYONE ELSE IS PINNED to their own id. Note that a member-supplied
     * `memberId` is DISCARDED rather than rejected: a 400 would tell an
     * attacker the parameter exists and is being checked. Silently scoping to
     * self reveals nothing and is impossible to bypass.
     *
     * This mirrors the guard's own rule - `if (user.role === Role.ADMIN) return
     * true` - so both paths agree about what "admin" means.
     */
    const memberId = user.role === Role.ADMIN ? query.memberId : user.id;

    return this.projectsService.findAll(
      { search: query.search, status: query.status, memberId },
      query,
    );
  }

  /**
   * READ requires MEMBERSHIP - any project role will do.
   *
   * The guard is applied per route rather than to the class, because `POST
   * /projects` and `GET /projects` have no project to check yet.
   */
  @UseGuards(ProjectAccessGuard)
  @Get(':id')
  findOne(@Param('id', ParseObjectIdPipe) id: string): Promise<Project> {
    return this.projectsService.findById(id);
  }

  /** WRITE requires the MANAGER role WITHIN this project. */
  @UseGuards(ProjectAccessGuard)
  @ProjectRoles(Role.MANAGER)
  @Patch(':id')
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<Project> {
    return this.projectsService.update(id, dto);
  }

  /**
   * `@HttpCode(200)` because POST defaults to 201 Created, and this creates
   * nothing - it transitions an existing resource. 201 would tell a client (and
   * a caching proxy) that a new resource exists somewhere, which is untrue.
   */
  @UseGuards(ProjectAccessGuard)
  @ProjectRoles(Role.MANAGER)
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(@Param('id', ParseObjectIdPipe) id: string): Promise<Project> {
    return this.projectsService.archive(id);
  }

  @UseGuards(ProjectAccessGuard)
  @ProjectRoles(Role.MANAGER)
  @Post(':id/members')
  @HttpCode(HttpStatus.OK)
  addMember(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddProjectMemberDto,
  ): Promise<Project> {
    return this.projectsService.addMember(id, dto);
  }

  /**
   * Two route parameters, bound BY NAME - argument order is irrelevant.
   *
   * Returns the updated project rather than 204, because the client needs the
   * new member list to re-render. "204 for every DELETE" is a convention, not a
   * rule; returning the affected resource saves a round trip.
   */
  @UseGuards(ProjectAccessGuard)
  @ProjectRoles(Role.MANAGER)
  @Delete(':id/members/:userId')
  removeMember(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
  ): Promise<Project> {
    return this.projectsService.removeMember(id, userId);
  }
}
