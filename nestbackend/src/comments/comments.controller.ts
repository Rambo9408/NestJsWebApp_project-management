import { Controller, Delete, HttpCode, HttpStatus, Param } from '@nestjs/common';

import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from 'src/auth/auth.types';

import { CommentsService } from './comments.service';

/**
 * Only the operations that act on a comment BY ITS OWN ID live here.
 *
 * Creating and listing happen under `/tasks/:id/comments`, because a comment
 * cannot exist without a task - the nesting expresses ownership. Deleting one
 * does not need the task, so it gets a flat, stable URL.
 *
 * That split is the usual REST compromise: nest for creation and listing where
 * the parent is required context, flatten once the child has its own identity.
 * Nesting everything (`/tasks/:id/comments/:cid`) makes URLs nobody builds
 * correctly.
 */
/**
 * =============================================================================
 * CommentsController - DEPRECATED SHAPE, kept working
 * =============================================================================
 * Comment deletion now lives at DELETE /tasks/:id/comments/:commentId, nested
 * under the task like create and list already were.
 *
 * WHY THE MOVE: a bare comment id gives no route to the project that owns the
 * membership rule, so this endpoint could only ever enforce "author or admin".
 * The nested route reaches TaskAccessGuard for membership and can therefore
 * also allow a project MANAGER to moderate - which is the behaviour a real
 * product wants.
 *
 * THIS ROUTE REMAINS, with the narrower author-or-admin rule, because removing
 * a published endpoint is a breaking change and this project has an OpenAPI
 * document that clients may already have generated from. Deprecate, migrate,
 * then delete - in that order.
 *
 * @deprecated Use DELETE /tasks/:taskId/comments/:commentId.
 * =============================================================================
 */
@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  /**
   * THE ACTOR IS PASSED IN. Before the fix this took only an id, so any
   * authenticated user could delete any comment - verified in the audit.
   *
   * Authorization lives in the SERVICE rather than a guard here, because the
   * rule (author-or-admin) needs the comment itself, and loading it in a guard
   * only to load it again in the service is work for nothing. A guard earns its
   * place when the check is reusable across routes; this one is not.
   */
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.commentsService.remove(id, actor);
  }
}
