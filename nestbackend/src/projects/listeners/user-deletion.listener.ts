import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { DomainEvent, UserDeletionRequestedEvent } from 'src/events/domain-events';

import { ProjectsService } from '../projects.service';

/**
 * =============================================================================
 * The other half of the inversion
 * =============================================================================
 * This listener holds the rule that used to live inside `UsersService`:
 *
 *     "you may not delete a user who still owns active projects"
 *
 * NOTICE WHERE IT LIVES NOW. The rule is about PROJECTS, so it belongs to
 * `ProjectsModule` - which is the module that can answer it without asking
 * anyone. Phase 4 had it in `UsersService`, which is exactly why `UsersService`
 * needed to know that projects exist.
 *
 * The dependency direction is now:
 *
 *     UsersService ──emits──▶ [event bus] ◀──listens── ProjectsModule
 *
 * Neither module imports the other. The bus is infrastructure, so depending on
 * it is not a feature-to-feature dependency at all.
 *
 * -----------------------------------------------------------------------------
 * `@OnEvent` - the mechanics
 * -----------------------------------------------------------------------------
 * The decorator registers this method as a listener at bootstrap. A few options
 * matter:
 *
 *   `{ async: true }`   the emitter awaits it (only meaningful with emitAsync)
 *   `{ promisify: true }` wrap a sync listener's result in a promise
 *   `{ suppressErrors: false }` let a throw propagate to the emitter
 *
 * We rely on `emitAsync` awaiting listeners, which it does by default.
 *
 * THIS LISTENER OBJECTS; IT DOES NOT THROW. Adding a string to `blockers` lets
 * the emitter collect every objection and report them together - and lets a
 * second vetoing listener coexist with this one. Throwing would abort the flow
 * at whichever listener happened to run first, so the user would see one
 * arbitrary reason out of several. The distinction matters more than it looks:
 * "you own 3 projects; you have an unpaid invoice" is a far better error than
 * whichever of the two fired first.
 * =============================================================================
 */
@Injectable()
export class UserDeletionListener {
  private readonly logger = new Logger(UserDeletionListener.name);

  constructor(private readonly projects: ProjectsService) {}

  @OnEvent(DomainEvent.USER_DELETION_REQUESTED)
  async onUserDeletionRequested(event: UserDeletionRequestedEvent): Promise<void> {
    const owned = await this.projects.countActiveOwnedBy(event.userId);

    if (owned > 0) {
      this.logger.debug(`Blocking deletion of ${event.userId}: owns ${owned} active project(s)`);

      event.blockers.push(
        `Cannot delete a user who owns ${owned} active project(s); archive or transfer them first`,
      );
    }
  }
}
