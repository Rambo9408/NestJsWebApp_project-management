import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthenticatedUser } from 'src/auth/auth.types';
import { Role } from 'src/common/enums/role.enum';
import { PROJECT_ROLES_KEY } from 'src/projects/guards/project-access.guard';
import { ProjectsService } from 'src/projects/projects.service';

import { TasksService } from '../tasks.service';

/**
 * =============================================================================
 * TaskAccessGuard - object-level authorization for /tasks/:id
 * =============================================================================
 * THE VULNERABILITY THIS CLOSES, found by a systematic endpoint audit and
 * reproduced end to end: an authenticated user with NO relationship to a
 * project could read, rename, reassign and DELETE any task in the system, and
 * delete its comments. Alice's task was destroyed by Mallory in a single script.
 *
 *     GET    /tasks/:id            200   read another user's task
 *     PATCH  /tasks/:id            200   rename it
 *     PATCH  /tasks/:id/status     200   move it
 *     DELETE /tasks/:id            200   destroy it
 *
 * -----------------------------------------------------------------------------
 * WHY ProjectAccessGuard COULD NOT SIMPLY BE REUSED
 * -----------------------------------------------------------------------------
 * That guard finds a project id by looking at `params.projectId ?? params.id`,
 * plus the body and query. On `/tasks/:id` the `id` param is a TASK id, so it
 * would look up a PROJECT by a task id, find nothing, and 404.
 *
 * That would "work" in the sense of denying Mallory - and it would deny Alice
 * too, because the lookup fails for everybody. A guard that denies everyone is
 * not secure, it is broken.
 *
 * THE MISSING STEP IS THE INDIRECTION: a task does not carry membership, its
 * PROJECT does. So this guard resolves task -> projectId -> membership.
 *
 * THE GENERAL LESSON, and it is the useful one: object-level authorization has
 * to follow the OWNERSHIP CHAIN, and the chain is different for every resource.
 * A task is owned via its project; a comment via its task via its project; a
 * notification directly by a user. One guard cannot serve them all, and
 * pretending otherwise is how routes end up unguarded - which is exactly what
 * happened here.
 *
 * IT HONOURS @ProjectRoles() by reading the SAME metadata key as
 * ProjectAccessGuard, so `@ProjectRoles(Role.MANAGER)` means the same thing on
 * a task route as on a project route. Two guards inventing two vocabularies for
 * the same idea is its own bug class.
 * =============================================================================
 */
@Injectable()
export class TaskAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(PROJECT_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; params: Record<string, string> }>();

    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication is required');

    // A global ADMIN bypasses project membership - the same short-circuit
    // ProjectAccessGuard applies, so both agree on what "admin" means.
    if (user.role === Role.ADMIN) return true;

    const taskId = request.params.id;
    if (!taskId) {
      // The guard is on a route with no task id. Fail closed and loudly rather
      // than silently allowing - a misplaced guard must never read as a pass.
      throw new ForbiddenException('This route requires a task identifier');
    }

    /**
     * `findById` throws NotFoundException for a task that does not exist, which
     * is the response we want anyway. No special handling needed.
     */
    const task = await this.tasksService.findById(taskId);
    const project = await this.projectsService.findById(task.projectId);

    const membership = project.members.find((member) => member.userId === user.id);

    if (!membership) {
      /**
       * 404, NOT 403 - and this is deliberate, matching ProjectAccessGuard.
       *
       * 403 says "this exists and you may not have it", which confirms the
       * resource to a stranger. Given an id, an attacker could map which task
       * ids are real. 404 reveals nothing: indistinguishable from a task that
       * was never created.
       *
       * The trade-off is honest: a legitimate member who mistypes an id gets a
       * slightly less helpful error. That is the right way round.
       */
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    if (!requiredRoles || requiredRoles.length === 0) return true;

    if (!requiredRoles.includes(membership.role)) {
      throw new ForbiddenException(
        `This action requires one of the following project roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
