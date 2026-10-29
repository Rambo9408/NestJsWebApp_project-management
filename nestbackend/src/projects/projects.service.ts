import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CacheService } from 'src/cache/cache.service';
import { cacheKeys } from 'src/cache/cache.keys';
import { Paginated, PaginationQuery, paginate } from 'src/common/dto/pagination.query';
import { Role } from 'src/common/enums/role.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationType } from 'src/notifications/schemas/notification.schema';
import { UsersService } from 'src/users/users.service';

import { AddProjectMemberDto, CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Project, ProjectStatus } from './entities/project.entity';
import { ProjectFilter, ProjectsRepository } from './repositories/projects.repository';

/**
 * =============================================================================
 * ProjectsService - CROSS-MODULE dependency injection
 * =============================================================================
 * This is the first class that depends on ANOTHER FEATURE MODULE. Three things
 * had to line up for the injection below to work, and if any one is missing you
 * get "Nest can't resolve dependencies":
 *
 *   1. `UsersService` is decorated with `@Injectable()`         (users.service.ts)
 *   2. `UsersModule` lists it in `providers` AND in `exports`   (users.module.ts)
 *   3. `ProjectsModule` lists `UsersModule` in `imports`        (projects.module.ts)
 *
 * Miss #2 and the class is private to UsersModule. Miss #3 and this module
 * cannot see UsersModule's exports at all. Both produce the same error message,
 * which is why the debugging checklist in Phase 4 walks them in order.
 *
 * -----------------------------------------------------------------------------
 * DEPENDING ON A SERVICE, NOT ON A REPOSITORY
 * -----------------------------------------------------------------------------
 * We inject `UsersService`, not `UsersRepository`. The distinction is the whole
 * argument for module boundaries:
 *
 *   - `UsersService.findById()` is a CONTRACT: "give me this user or fail".
 *     UsersModule is free to change how users are stored, add caching, or move
 *     behind an HTTP call to a future user microservice, and this file does not
 *     change.
 *   - `UsersRepository` is an IMPLEMENTATION DETAIL, and it is not exported, so
 *     the framework refuses to let us reach for it.
 *
 * That refusal is the single most valuable property of Nest modules. It is also
 * exactly the seam you would cut along in Phase 20: replace the injected
 * `UsersService` with a client that calls a remote service, and nothing else in
 * this file moves.
 *
 * -----------------------------------------------------------------------------
 * A DELIBERATE ONE-WAY DEPENDENCY (and a preview of Phase 4)
 * -----------------------------------------------------------------------------
 *     ProjectsService ──depends on──> UsersService
 *
 * It does NOT go the other way, and keeping it that way is a design decision,
 * not luck. The obvious temptation arrives soon: "before deleting a user, check
 * they do not own any projects", which would make `UsersService` depend on
 * `ProjectsService` and close the loop:
 *
 *     UsersService ──> ProjectsService ──> UsersService     ← circular
 *
 * Nest can be forced through that with `forwardRef()`, and Phase 4 shows how -
 * along with the three better answers (invert with a domain event, extract the
 * shared rule into a third module, or move the check to the caller). The
 * message to carry into an interview: `forwardRef()` compiles; it does not fix
 * the design.
 * =============================================================================
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly projectsRepository: ProjectsRepository,

    /**
     * PHASE 13: the forwardRef is gone from THIS side too.
     *
     * The cycle had two edges. Removing the Users -> Projects edge (that
     * service now emits an event) leaves this one pointing in a single
     * direction, which needs no deferral:
     *
     *     ProjectsService ──▶ UsersService        (still direct, still fine)
     *     UsersService    ──▶ [event bus] ◀── ProjectsModule listener
     *
     * A one-way dependency between feature modules is normal and healthy. It
     * was only ever the SECOND arrow that made it a cycle.
     */
    private readonly usersService: UsersService,
    /**
     * Resolved from NotificationsModule's exports (Phase 3).
     *
     * Note what this service does NOT know: whether a notification becomes a
     * console line, an email, or nothing at all. That decision was made once,
     * by a `useFactory` provider in `notifications.module.ts`, from injected
     * configuration. This is the practical payoff of a runtime-selected
     * strategy - the choice exists in exactly one file, and no business logic
     * anywhere contains `if (isProduction)`.
     *
     * PHASE 13 PREVIEW: this direct dependency is the honest starting point,
     * and it does not scale. Adding a member should soon ALSO write an activity
     * log, and later update a dashboard counter - one new dependency per
     * feature, until this constructor knows about half the system. Phase 13
     * inverts it: `ProjectsService` emits `project.member_added` and whoever
     * cares subscribes. Direct call now, event later, and the reason for the
     * change is visible right here.
     */
    private readonly notifications: NotificationsService,

    /**
     * PHASE 10. Added specifically to pay off the debt Phase 8 created:
     * ProjectAccessGuard loads the project, then this service loads it AGAIN,
     * doubling reads on every guarded request. Now the second read is a cache
     * hit.
     */
    private readonly cache: CacheService,
  ) {}

  async create(dto: CreateProjectDto, ownerId: string): Promise<Project> {
    /**
     * REFERENTIAL INTEGRITY, enforced in the application.
     *
     * MongoDB does not have foreign keys, so nothing at the database level
     * stops us storing an `ownerId` that points at no one. `findById` throws
     * 404 if the user is missing, so this single call both validates and
     * documents the dependency.
     *
     * TRADE-OFF worth naming: this is an extra round trip on every project
     * creation. That is cheap and correct here. At high volume, or across a
     * service boundary, the alternatives are to accept eventual consistency
     * (create optimistically, reconcile asynchronously) or to duplicate the
     * minimum user data you need. Which is right depends on whether a dangling
     * reference is a nuisance or a disaster.
     */
    await this.usersService.findById(ownerId);

    const existingKey = await this.projectsRepository.findByKey(dto.key);
    if (existingKey) {
      throw new ConflictException(`Project key "${dto.key.toUpperCase()}" is already in use`);
    }

    const project = await this.projectsRepository.create({
      key: dto.key.toUpperCase(),
      name: dto.name.trim(),
      description: dto.description?.trim() ?? '',
      ownerId,
      status: ProjectStatus.ACTIVE,
      // The owner is a member from the start, so membership queries never need
      // to special-case "or is the owner". Modelling the implicit relationship
      // explicitly removes a whole family of "the owner cannot see their own
      // project" bugs.
      members: [{ userId: ownerId, role: Role.MANAGER, joinedAt: new Date() }],
    });

    this.logger.log(`Project created: ${project.key} (${project.id})`);
    return project;
  }

  async findAll(filter: ProjectFilter, pagination: PaginationQuery): Promise<Paginated<Project>> {
    const { items, total } = await this.projectsRepository.findAll(filter, pagination);
    return paginate(items, total, pagination);
  }

  /**
   * The set of project ids a user may see - their authorization scope.
   *
   * Used by TasksController to constrain the task list. Exposed on the service
   * rather than reaching into the repository from another module, so the
   * membership rule ("owner OR member") stays defined in one place.
   */
  findAccessibleProjectIds(userId: string): Promise<string[]> {
    return this.projectsRepository.findIdsForMember(userId);
  }

  /**
   * How many ACTIVE projects this user owns.
   *
   * PHASE 4: this method is why `UsersService` now depends on `ProjectsService`,
   * which closes the loop and creates the circular dependency the whole phase is
   * about. It is a deliberately realistic trigger: "do not delete a user who
   * still owns live projects" is exactly the kind of rule that tempts you into
   * a cycle.
   *
   * Note the interface is DELIBERATELY NARROW - a count, not a list, not a
   * repository. When you are forced into a cross-aggregate dependency, keeping
   * the surface as small as possible limits the damage and makes the eventual
   * refactor (Phase 13) trivial.
   */
  async countActiveOwnedBy(userId: string): Promise<number> {
    /**
     * PHASE 5: this used to load every active project and filter in JavaScript,
     * because the in-memory store had no owner filter. Now it is one
     * `countDocuments({ ownerId, status })` served by the partial index on
     * `{ ownerId, createdAt }` - one round trip, zero documents transferred.
     *
     * Pushing a filter down to the database is not a micro-optimisation; it is
     * the difference between O(1) and O(n) network traffic. The service did not
     * change shape, only the repository did - which is the whole point of
     * having a repository.
     */
    return this.projectsRepository.countActiveOwnedBy(userId);
  }

  /**
   * ===========================================================================
   * CACHE-ASIDE, on the hottest read in the application
   * ===========================================================================
   * WHY THIS METHOD AND NOT EVERYTHING? Caching has a cost - staleness, an
   * invalidation path to keep correct, and memory. It is worth paying where a
   * read is FREQUENT and the data changes RARELY. This one qualifies twice
   * over:
   *
   *   - `ProjectAccessGuard` calls it on every guarded request, and then the
   *     handler's service calls it again. That duplicate read was named as
   *     debt in Phase 8; this is the payment.
   *   - A project's name and membership change far less often than they are
   *     read.
   *
   * WHAT IS NOT CACHED, deliberately: `findAll`. A list keyed by filter, page,
   * sort and the caller's membership has an enormous key space, a poor hit
   * rate, and an invalidation story that has to consider every write. Caching
   * lists is where most caching layers go wrong - the entries are rarely reused
   * and almost never correctly invalidated.
   *
   * THE STALENESS WINDOW is bounded by two things: explicit invalidation on
   * every write path below, and the TTL as a backstop for the write path
   * someone forgets. That second one is why every entry has a TTL.
   */
  async findById(id: string): Promise<Project> {
    const project = await this.cache.getOrSet(cacheKeys.project(id), () =>
      this.projectsRepository.findById(id),
    );

    // Note the 404 is thrown AFTER the cache lookup, and `getOrSet` does not
    // store `null` - so a missing project is not cached. See the cache-
    // penetration note in cache.service.ts for when that is the wrong default.
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  /**
   * Invalidate everything cached under one project.
   *
   * WHY DELETE RATHER THAN UPDATE the cached value ("write-through")? Because
   * deleting is idempotent and impossible to get subtly wrong. Writing the new
   * value means two writers can interleave and leave the CACHE holding an older
   * version than the DATABASE - and a cache that disagrees with the source of
   * truth in a way no TTL will fix is the worst possible outcome.
   *
   * Delete-on-write costs one extra database read on the next request. That is
   * the correct trade almost every time.
   *
   * ORDER MATTERS: the database write happens FIRST, then this. Invalidating
   * before the write leaves a window where a concurrent read repopulates the
   * cache with the OLD value, and it stays wrong until the TTL expires.
   */
  private async invalidateProject(id: string): Promise<void> {
    await this.cache.delByPrefix(cacheKeys.projectScope(id));
  }

  async update(id: string, dto: UpdateProjectDto): Promise<Project> {
    const project = await this.findById(id);

    if (project.status === ProjectStatus.ARCHIVED) {
      throw new ConflictException('Cannot modify an archived project');
    }

    const updated = await this.projectsRepository.update(id, {
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
    });

    if (!updated) throw new NotFoundException(`Project ${id} not found`);

    // Database first, THEN invalidate - see invalidateProject().
    await this.invalidateProject(id);
    return updated;
  }

  async addMember(projectId: string, dto: AddProjectMemberDto): Promise<Project> {
    const project = await this.findById(projectId);

    // Cross-module call again: 404s if the user does not exist. We keep the
    // returned user because the notification needs their email address.
    const member = await this.usersService.findById(dto.userId);

    if (project.members.some((member) => member.userId === dto.userId)) {
      throw new ConflictException('User is already a member of this project');
    }

    const updated = await this.projectsRepository.update(projectId, {
      members: [
        ...project.members,
        { userId: dto.userId, role: dto.role ?? Role.MEMBER, joinedAt: new Date() },
      ],
    });

    if (!updated) throw new NotFoundException(`Project ${projectId} not found`);

    // Database first, THEN invalidate - see invalidateProject().
    await this.invalidateProject(projectId);

    /**
     * NOTE THE MISSING `try/catch`, and the missing `.catch()`.
     *
     * `notify()` is documented never to throw - the swallow-and-log rule lives
     * inside `NotificationsService`, in exactly one place, precisely so that
     * fifteen call sites do not each have to remember it. Putting a `try/catch`
     * here as well would be defensive noise that hides where the rule actually
     * is.
     *
     * We DO await it, though. Not awaiting would make the notification a
     * floating promise: an unhandled rejection risk, and untestable, because
     * the spec's assertion can run before the send does. (This is why
     * `no-floating-promises` is an ESLint *error* in this project.)
     *
     * The cost of awaiting is that the HTTP response waits for the channel. For
     * a console write that is free; for an SMTP round trip it would be
     * unacceptable, which is the concrete reason Phase 12 moves delivery to a
     * queue - `notify()` then enqueues in a millisecond and a worker does the
     * slow part.
     */
    await this.notifications.notifyUser({
      userId: member.id,
      email: member.email,
      type: NotificationType.PROJECT_MEMBER_ADDED,
      title: `Added to project ${project.key}`,
      body: `You have been added to "${project.name}" as ${dto.role ?? Role.MEMBER}.`,
      meta: { projectId, userId: dto.userId },
    });

    return updated;
  }

  async removeMember(projectId: string, userId: string): Promise<Project> {
    const project = await this.findById(projectId);

    if (project.ownerId === userId) {
      throw new ConflictException('The project owner cannot be removed; transfer ownership first');
    }
    if (!project.members.some((member) => member.userId === userId)) {
      throw new NotFoundException('User is not a member of this project');
    }

    const updated = await this.projectsRepository.update(projectId, {
      members: project.members.filter((member) => member.userId !== userId),
    });

    if (!updated) throw new NotFoundException(`Project ${projectId} not found`);

    // Database first, THEN invalidate - see invalidateProject().
    await this.invalidateProject(projectId);
    return updated;
  }

  async archive(id: string): Promise<Project> {
    const project = await this.findById(id);

    /**
     * IDEMPOTENCY. Archiving an already-archived project succeeds and returns
     * the same state rather than throwing.
     *
     * Why that is the right call: this endpoint will eventually be triggered by
     * retries and background jobs, and "the operation already achieved its
     * goal" is success, not an error. Getting idempotency right here is the
     * same reasoning Phase 12 applies to queue consumers, where a job WILL be
     * delivered twice sooner or later.
     */
    if (project.status === ProjectStatus.ARCHIVED) return project;

    const updated = await this.projectsRepository.update(id, { status: ProjectStatus.ARCHIVED });
    if (!updated) throw new NotFoundException(`Project ${id} not found`);

    // Database first, THEN invalidate - see invalidateProject().
    await this.invalidateProject(id);

    this.logger.log(`Project archived: ${updated.key}`);
    return updated;
  }
}
