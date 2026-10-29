import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Observable, interval, map, merge } from 'rxjs';

import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Paginated, PaginationQuery, paginate } from 'src/common/dto/pagination.query';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';

import { NotificationStreamService } from './notification-stream.service';
import { NotificationView, NotificationsRepository } from './notifications.repository';

/**
 * =============================================================================
 * NotificationsController - REST for history, SSE for live delivery
 * =============================================================================
 *     GET   /api/v1/notifications             history (paginated)
 *     GET   /api/v1/notifications/unread-count
 *     PATCH /api/v1/notifications/:id/read
 *     POST  /api/v1/notifications/read-all
 *     GET   /api/v1/notifications/stream      <- SSE
 *
 * THE TWO HALVES ARE NOT REDUNDANT. The REST endpoints are the source of truth
 * and the recovery path; the stream is the optimisation. A client's correct
 * algorithm is:
 *
 *   1. on load / on reconnect: GET the unread list
 *   2. then: apply events from the stream
 *
 * Anything that relies on the stream ALONE loses notifications to a dropped
 * connection, a closed tab, or a deploy - and does so invisibly.
 * =============================================================================
 */
@ApiBearerAuth('access-token')
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly stream: NotificationStreamService,
  ) {}

  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQuery,
    @Query('unread') unread?: string,
  ): Promise<Paginated<NotificationView>> {
    const { items, total } = await this.notifications.findForUser(userId, query, unread === 'true');
    return paginate(items, total, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser('id') userId: string): Promise<{ unread: number }> {
    return { unread: await this.notifications.countUnread(userId) };
  }

  /**
   * ===========================================================================
   * SERVER-SENT EVENTS
   * ===========================================================================
   * `@Sse()` makes Nest hold the response open, set
   * `Content-Type: text/event-stream`, and write each emitted value in the SSE
   * wire format:
   *
   *     id: 65f1...
   *     event: notification
   *     data: {"id":"65f1...","title":"WEB-142 assigned to you"}
   *     <blank line>
   *
   * THE HANDLER RETURNS AN OBSERVABLE THAT NEVER COMPLETES. That is the whole
   * reason Nest models responses as Observables rather than Promises (Phase 9)
   * - a promise resolves once and the connection would close.
   *
   * ---------------------------------------------------------------------------
   * SSE vs WEBSOCKETS - the decision, not the trivia
   * ---------------------------------------------------------------------------
   *                        SSE                      WebSocket
   *   Direction            server -> client only    bidirectional
   *   Protocol             plain HTTP               upgrade to ws://
   *   Reconnection         AUTOMATIC, built in      you write it
   *   Proxies / corporate  works (it is just HTTP)  often blocked
   *   HTTP/2 multiplexing  yes                      no (own connection)
   *   Auth                 awkward - see below      handshake payload
   *   Binary               no (text only)           yes
   *   Browser conn. limit  6 per origin on HTTP/1.1 not affected
   *
   * DEFAULT TO SSE for server->client push. It is less code, it survives
   * corporate proxies, and the browser reconnects for you with backoff - which
   * is the part people underestimate, because reconnection logic is where
   * hand-rolled WebSocket clients go wrong.
   *
   * REACH FOR WEBSOCKETS when the client must send a stream too: chat,
   * collaborative editing, presence, live cursors. Notifications are one-way,
   * so SSE is the right default here - and the gateway in this module exists
   * because typing indicators and presence are genuinely bidirectional.
   *
   * THE HTTP/1.1 SIX-CONNECTION LIMIT is the one real SSE gotcha: a browser
   * allows six connections per origin, and an open SSE stream holds one. Open a
   * few tabs and the app stops loading images. HTTP/2 removes it entirely
   * (multiplexed), which in practice means "make sure production is HTTP/2".
   * ===========================================================================
   */
  @Sse('stream')
  stream$(@CurrentUser('id') userId: string): Observable<MessageEvent> {
    /**
     * A HEARTBEAT, and it is not optional.
     *
     * Idle connections are killed by every intermediary that exists: load
     * balancers (AWS ALB defaults to 60s), nginx (`proxy_read_timeout` 60s),
     * corporate proxies, and mobile carriers. A user who receives no
     * notification for a minute silently loses the stream - and because
     * EventSource reconnects automatically, the symptom is a connection that
     * cycles every 60 seconds rather than an obvious failure.
     *
     * A comment line every 30 seconds keeps the socket warm. The `type: 'ping'`
     * means clients can ignore it with one line rather than parsing it as data.
     */
    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ type: 'ping', data: JSON.stringify({ t: Date.now() }) })),
    );

    const notifications$ = this.stream
      .sseForUser(userId)
      .pipe(map((event) => event as unknown as MessageEvent));

    /**
     * `merge` rather than `combineLatest` or `concat`: both sources emit
     * independently and neither completes.
     *
     * NOTE WHAT IS MISSING and is deliberate: no `timeout()`. Phase 9's
     * TimeoutInterceptor is applied per controller precisely so it never lands
     * here - a 15-second timeout on a stream that is supposed to live for hours
     * would look like a mysterious reconnect loop.
     */
    return merge(notifications$, heartbeat$);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    // The user id goes into the QUERY FILTER, not a check afterwards - see the
    // note in the repository.
    await this.notifications.markRead(id, userId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser('id') userId: string): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(userId) };
  }
}
