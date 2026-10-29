import { Injectable, NotFoundException } from '@nestjs/common';

import { Paginated, PaginationQuery, paginate } from 'src/common/dto/pagination.query';
import { UsersService } from 'src/users/users.service';

import { CommentView, CommentsRepository } from './comments.repository';
import { Role } from 'src/common/enums/role.enum';

/**
 * =============================================================================
 * CommentsService
 * =============================================================================
 * NOTE WHAT THIS SERVICE DOES NOT DO: it never checks that the task exists.
 *
 * That is deliberate, and it is a dependency-direction decision. If
 * `CommentsService` validated the task, it would need `TasksService` - and
 * `TasksService` already needs `CommentsRepository` for the cascading-delete
 * transaction. That is a circular dependency, and Phase 4 was clear that the
 * right response is to remove the cycle rather than reach for `forwardRef`.
 *
 * So the arrow points ONE WAY:
 *
 *     TasksModule ──imports──> CommentsModule
 *
 * `TasksService` owns "does this task exist?" (it already loads the task for
 * every operation) and delegates the comment work here. `CommentsModule` knows
 * nothing about tasks beyond an id.
 *
 * That is option 3 from the Phase 4 list - "extract/assign the responsibility so
 * the arrows point one way" - applied BEFORE the cycle existed rather than after.
 * Cheaper every time.
 * =============================================================================
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly commentsRepository: CommentsRepository,
    private readonly usersService: UsersService,
  ) {}

  async create(taskId: string, data: { body: string; authorId: string }): Promise<CommentView> {
    // Referential integrity for the author; the caller has already verified the
    // task. MongoDB has no foreign keys, so these checks are the application's
    // job - see the note in ProjectsService.create.
    await this.usersService.findById(data.authorId);

    return this.commentsRepository.create({
      body: data.body.trim(),
      taskId,
      authorId: data.authorId,
    });
  }

  async listForTask(taskId: string, pagination: PaginationQuery): Promise<Paginated<CommentView>> {
    const { items, total } = await this.commentsRepository.findByTask(taskId, pagination);
    return paginate(items, total, pagination);
  }

  /**
   * Soft delete. The row survives so replies still make sense; the content goes.
   *
   * Returns nothing - the caller gets 204. Deleting an already-deleted comment
   * returns false from the repository and 404 here, which is a defensible
   * choice; returning 204 for both would make it idempotent. Pick one and
   * document it (we chose the informative one, because a client deleting
   * something twice usually has a bug worth surfacing).
   */
  /**
   * ===========================================================================
   * DELETE - AUTHORIZED. Previously it was not.
   * ===========================================================================
   * THE VULNERABILITY: this method used to take an id and nothing else, and the
   * controller passed no user. Any authenticated account could delete ANY
   * comment in the system by id. Reproduced in the audit - Mallory deleted
   * Alice's comment and got a 204.
   *
   * THE RULE APPLIED HERE: the AUTHOR may delete their own comment; a global
   * ADMIN may delete any.
   *
   * WHY NOT ALSO A PROJECT MANAGER, which would be reasonable moderation? It
   * would require the comment -> task -> project chain, and `CommentsModule`
   * does not import ProjectsModule or TasksModule. Adding those imports would
   * create a CYCLE, because TasksModule already imports CommentsModule (it
   * needs the repository to join the cascading-delete transaction).
   *
   * Breaking that cycle properly means either a guard living in TasksModule on
   * a `/tasks/:id/comments/:commentId` route, or an events-based approach. Both
   * are defensible; neither is a five-minute change, and shipping the
   * author-or-admin rule now closes the hole completely for the case that
   * actually matters.
   *
   * FLAGGED RATHER THAN HIDDEN: "project managers cannot moderate comments" is
   * a product decision this code is currently making by omission. It should be
   * a deliberate one.
   * ===========================================================================
   */
  async remove(id: string, actor: { id: string; role: Role }): Promise<void> {
    const comment = await this.commentsRepository.findById(id);

    /**
     * 404 BEFORE the authorization check, and 404 AFTER it fails - the two are
     * deliberately indistinguishable. Returning 403 for "exists but not yours"
     * would let an attacker enumerate which comment ids are real.
     */
    if (!comment) throw new NotFoundException(`Comment ${id} not found`);

    const isAuthor = comment.authorId === actor.id;
    if (!isAuthor && actor.role !== Role.ADMIN) {
      throw new NotFoundException(`Comment ${id} not found`);
    }

    const removed = await this.commentsRepository.softDelete(id);
    if (!removed) throw new NotFoundException(`Comment ${id} not found`);
  }

  countForTask(taskId: string): Promise<number> {
    return this.commentsRepository.countByTask(taskId);
  }
}
