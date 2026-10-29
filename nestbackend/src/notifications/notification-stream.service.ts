import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Observable, Subject, filter, map } from 'rxjs';

import { REDIS_CLIENT, REDIS_SUBSCRIBER } from 'src/common/constants';

export interface NotificationEvent {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

/** The Redis channel every instance publishes to and subscribes from. */
const CHANNEL = 'taskflow:notifications';

/**
 * =============================================================================
 * NotificationStreamService - the fan-out that makes real-time work at scale
 * =============================================================================
 * THE PROBLEM THIS SOLVES, and it is the single most important thing to
 * understand about scaling SSE or WebSockets:
 *
 *   A connection is held by ONE PROCESS. Ana's browser has an open stream to
 *   instance #3. When Ben adds her to a project, that request is load-balanced
 *   to instance #7 - which holds no connection to Ana and cannot reach her.
 *
 * On one instance an in-memory `Subject` is enough. On two it is silently
 * broken: notifications are delivered only when the writer and the reader
 * happen to land on the same process, so it works perfectly in development and
 * about half the time in production. That is a genuinely nasty class of bug,
 * because "it works sometimes" reads like a flaky network rather than a design
 * error.
 *
 * THE FIX: a message bus every instance subscribes to.
 *
 *   instance #7  ──publish──▶  Redis Pub/Sub  ──▶ every instance
 *                                                 │
 *                              instance #3 holds Ana's stream ──▶ Ana
 *
 * WHY REDIS PUB/SUB - and its honest limits:
 *   + Already here, one line to use, sub-millisecond.
 *   - FIRE AND FORGET. No persistence, no acknowledgement, no replay. A message
 *     published while an instance is restarting is gone for that instance.
 *   - AT MOST ONCE delivery.
 *
 * Those limits are ACCEPTABLE HERE precisely because the durable record is in
 * MongoDB: the stream is an optimisation, and a missed push costs a user a
 * refresh, not a lost notification. If the push itself had to be reliable you
 * would need Redis Streams (which have consumer groups and replay), or Kafka /
 * NATS JetStream. Choosing fire-and-forget is only defensible when something
 * else is durable - and that is the interview answer.
 *
 * TWO CONNECTIONS ARE REQUIRED, and this is why `REDIS_SUBSCRIBER` exists as a
 * separate token (Phase 3): a Redis connection in SUBSCRIBER MODE cannot issue
 * normal commands. Sharing one client between `SUBSCRIBE` and `GET` breaks
 * both, and the error message ("Connection in subscriber mode, only subscriber
 * commands may be used") is memorable once you have seen it.
 * =============================================================================
 */
@Injectable()
export class NotificationStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationStreamService.name);

  /**
   * The LOCAL stream. Everything this instance's SSE and WebSocket clients read
   * comes from here; Redis only feeds it.
   *
   * A `Subject` and not a `ReplaySubject`: late subscribers must NOT receive
   * history. A user who connects at 10:00 should not be handed every
   * notification since boot - that is what the REST endpoint is for, and a
   * replay buffer is also an unbounded memory leak.
   */
  private readonly local$ = new Subject<NotificationEvent>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly publisher: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.subscriber.subscribe(CHANNEL);

      this.subscriber.on('message', (channel: string, payload: string) => {
        if (channel !== CHANNEL) return;

        try {
          this.local$.next(JSON.parse(payload) as NotificationEvent);
        } catch (error) {
          // A malformed message must never take down the subscriber - it would
          // silently stop delivery for every user on this instance.
          this.logger.warn(`Discarding malformed notification payload: ${describe(error)}`);
        }
      });

      this.logger.log(`Subscribed to ${CHANNEL}`);
    } catch (error) {
      /**
       * DEGRADE. With no Redis there is no cross-instance fan-out, but the
       * LOCAL subject still works - so a single-instance deployment keeps
       * functioning, and a multi-instance one delivers to whoever happens to be
       * connected to the publishing process.
       *
       * Same rule as everywhere else: Redis makes this faster and wider, it does
       * not make the application correct. The durable record is the guarantee.
       */
      this.logger.warn(`Notification fan-out unavailable: ${describe(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.local$.complete();

    try {
      await this.subscriber.unsubscribe(CHANNEL);
    } catch {
      // Already disconnected. A shutdown path must never throw.
    }
  }

  /**
   * Publish to EVERY instance.
   *
   * Note it publishes rather than calling `local$.next()` directly: the
   * subscriber on THIS instance receives its own message back, so there is
   * exactly one delivery path and no "works locally, not remotely" asymmetry to
   * debug. The extra round trip is sub-millisecond and buys uniformity.
   */
  async publish(event: NotificationEvent): Promise<void> {
    try {
      await this.publisher.publish(CHANNEL, JSON.stringify(event));
    } catch (error) {
      this.logger.debug(`Publish failed, falling back to local delivery: ${describe(error)}`);
      // Degraded path: at least reach clients connected to THIS instance.
      this.local$.next(event);
    }
  }

  /**
   * One user's stream.
   *
   * `filter` per subscriber is the simple approach and it is O(subscribers) per
   * event on this instance. Fine for thousands of connections; at a hundred
   * thousand you would shard the Redis channel per user
   * (`taskflow:notifications:{userId}`) so an instance only receives what it
   * can deliver. Worth knowing the upgrade path, not worth building early.
   */
  forUser(userId: string): Observable<NotificationEvent> {
    return this.local$.asObservable().pipe(filter((event) => event.userId === userId));
  }

  /**
   * EVERY event reaching this instance, unfiltered.
   *
   * Used by the WebSocket gateway, which routes by Socket.IO ROOM rather than
   * by a per-subscriber filter - one subscription for the whole gateway instead
   * of one per connected socket. See the note in `notifications.gateway.ts` for
   * why that matters.
   */
  all$(): Observable<NotificationEvent> {
    return this.local$.asObservable();
  }

  /** The same stream, shaped as SSE `MessageEvent`s. */
  sseForUser(userId: string): Observable<{ id: string; type: string; data: string }> {
    return this.forUser(userId).pipe(
      map((event) => ({
        /**
         * `id` is not decoration. A browser's `EventSource` remembers the last
         * id it saw and sends it back as `Last-Event-ID` when it reconnects, so
         * a server CAN resume from that point.
         *
         * We do not implement resume here - the client re-fetches unread
         * notifications over REST on reconnect instead, which is simpler and
         * needs no server-side buffer. Sending the id anyway costs nothing and
         * leaves the door open.
         */
        id: event.id,
        // The SSE `event:` field, so a client can `addEventListener('notification')`
        // rather than parsing every message to find out what it is.
        type: 'notification',
        data: JSON.stringify(event),
      })),
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
