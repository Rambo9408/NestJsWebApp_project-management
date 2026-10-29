import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthenticatedUser } from 'src/auth/auth.types';
import { Role } from 'src/common/enums/role.enum';

import { ProjectsService } from '../projects.service';

export const PROJECT_ROLES_KEY = 'taskflow:projectRoles';

/**
 * `@ProjectRoles(Role.MANAGER)` - the caller must hold this role WITHIN the
 * project the request targets, not globally.
 *
 * With no argument, any membership is enough.
 */
export const ProjectRoles = (...roles: Role[]) => SetMetadata(PROJECT_ROLES_KEY, roles);

/**
 * =============================================================================
 * ProjectAccessGuard - RESOURCE-LEVEL authorization
 * =============================================================================
 * `RolesGuard` answers "is this user a MANAGER?". This answers the question that
 * actually matters:
 *
 *     "Is this user a manager OF THIS PROJECT?"
 *
 * A global role cannot answer that, because the answer depends on the resource.
 * Ana can be a MANAGER of the Website project and a plain MEMBER of Mobile -
 * which is exactly why `Project.members` carries its own role (Phase 2), and
 * why collapsing the two into one field is the classic RBAC modelling mistake.
 *
 * This is the half of authorization most implementations hand-wave, and it is
 * where the interesting interview questions live.
 *
 * -----------------------------------------------------------------------------
 * WHY A GUARD AND NOT A CHECK INSIDE THE SERVICE?
 * -----------------------------------------------------------------------------
 * Both are legitimate, and the distinction is worth being able to draw:
 *
 *   USE A GUARD when the policy is a property of the ROUTE and can be decided
 *   from the request plus one lookup. It runs before pipes and before the
 *   handler, it is declarative, and the policy is visible in the controller.
 *
 *   USE A SERVICE CHECK when the decision needs data the service is loading
 *   anyway, or when the same rule must hold for non-HTTP callers - a queue
 *   worker, a WebSocket message, a CLI script. A guard cannot protect those,
 *   because they never pass through the HTTP pipeline.
 *
 * The trap in this file is REAL and worth naming: this guard loads the project,
 * and then the handler's service loads it AGAIN. That is a duplicate query on
 * every guarded request. Mitigations, in order of preference:
 *   1. Attach the loaded project to the request and have the service accept it.
 *      Fast and explicit; couples the service slightly to the guard.
 *   2. Cache the read (Phase 10). One line, and the second read is ~0.2ms.
 *   3. Accept it. A single indexed `findById` is cheap, and correctness first.
 * We take (2) in Phase 10 and say so here, because "I added a guard and doubled
 * my database reads" is a genuine, common regression that nobody notices until
 * it is a p99 problem.
 * =============================================================================
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly projectsService: ProjectsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(PROJECT_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; params: Record<string, string> }>();

    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication is required');

    /**
     * A GLOBAL ADMIN BYPASSES PROJECT MEMBERSHIP.
     *
     * A deliberate product decision, not an oversight - and one to state
     * explicitly rather than leave implicit, because the alternative is
     * defensible too. Admins need to support customers and clean up abandoned
     * projects; requiring them to add themselves as a member first would mean
     * mutating the customer's data to read it.
     *
     * The cost is that an admin token is a skeleton key, so admin actions must
     * be audited (Phase 13's activity log) and admin accounts must have MFA.
     * "Admins bypass" without "admins are audited" is how you get a breach you
     * cannot reconstruct.
     */
    if (user.role === Role.ADMIN) return true;

    const projectId = this.extractProjectId(request);
    if (!projectId) {
      // No project in the request means this guard is on the wrong route.
      // Fail closed and loudly rather than silently allowing.
      throw new ForbiddenException('This route requires a project identifier');
    }

    /**
     * `findById` throws 404 for an unknown project, which is the RIGHT leak
     * profile here: a non-member asking about a project they cannot see gets
     * 404, not 403, so they cannot use the endpoint to discover which project
     * ids exist. (403 for a resource you are not allowed to know about is a
     * quiet enumeration oracle.)
     */
    const project = await this.projectsService.findById(projectId);

    const membership = project.members.find((member) => member.userId === user.id);

    if (!membership) {
      // Same reasoning: do not confirm the project exists to a stranger.
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    // No roles specified -> membership alone is enough.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    if (!requiredRoles.includes(membership.role)) {
      throw new ForbiddenException(
        `This action requires one of the following project roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }

  /**
   * Where the project id lives depends on the route shape:
   *
   *     /projects/:id/members          -> params.id
   *     POST /tasks { projectId }      -> body.projectId
   *     /tasks?projectId=...           -> query.projectId
   *
   * Checking all three keeps one guard usable across route shapes. The
   * alternative - a guard per shape - is more explicit and more files; this is
   * the trade-off most codebases make, and the risk to watch is a route where
   * the id appears in two places with different values.
   */
  private extractProjectId(request: Request): string | undefined {
    const params = request.params as Record<string, string> | undefined;
    const body = request.body as Record<string, unknown> | undefined;
    const query = request.query as Record<string, unknown> | undefined;

    const fromParams = params?.projectId ?? params?.id;
    const fromBody = typeof body?.projectId === 'string' ? body.projectId : undefined;
    const fromQuery = typeof query?.projectId === 'string' ? query.projectId : undefined;

    return fromParams ?? fromBody ?? fromQuery;
  }
}
