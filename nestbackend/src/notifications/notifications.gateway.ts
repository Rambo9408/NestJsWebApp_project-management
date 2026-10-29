import { Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { AccessTokenPayload } from 'src/auth/auth.types';
import { AppConfigService } from 'src/config';

import { NotificationStreamService } from './notification-stream.service';

/**
 * Socket.IO types `socket.data` as `any` by design - it is a bag for whatever
 * the application wants to put there. Reading and writing it through these two
 * helpers confines the assertion to one place instead of scattering `as string`
 * through every handler.
 */
function setUserId(socket: Socket, userId: string): void {
  (socket.data as { userId?: string }).userId = userId;
}

function getUserId(socket: Socket): string | undefined {
  return (socket.data as { userId?: string }).userId;
}

/**
 * =============================================================================
 * NotificationsGateway - WebSockets, and when they are actually the right tool
 * =============================================================================
 * The SSE endpoint already delivers notifications, so why a gateway at all?
 *
 * Because SSE is ONE-WAY. Everything below is client-to-server and cannot be
 * expressed with it:
 *
 *   - `task:typing`   somebody is writing a comment right now
 *   - presence        who is currently looking at this project
 *   - live cursors, collaborative editing
 *
 * "Use WebSockets for real-time" is the answer people give; "use SSE unless the
 * client needs to send a stream too" is the better one. This module runs both
 * deliberately, and each does the job it is suited to.
 *
 * -----------------------------------------------------------------------------
 * WHAT A GATEWAY IS
 * -----------------------------------------------------------------------------
 * The WebSocket analogue of a controller. `@SubscribeMessage('x')` is `@Post`,
 * the return value is emitted back to the caller, and - importantly - the SAME
 * guards, interceptors, pipes and filters apply, because they all work through
 * `ExecutionContext` rather than through `req`/`res`. That is exactly why
 * Phase 9's interceptor checks `context.getType() !== 'http'` before touching
 * the request object.
 *
 * -----------------------------------------------------------------------------
 * ROOMS: the mechanism that makes targeted delivery cheap
 * -----------------------------------------------------------------------------
 * Socket.IO rooms are server-side groupings. Joining `user:<id>` means the
 * server can emit to one user without tracking sockets itself, and without
 * iterating every connection to find the right one.
 *
 * -----------------------------------------------------------------------------
 * SCALING - the part that breaks in production
 * -----------------------------------------------------------------------------
 * A room lives in ONE PROCESS. With several instances, `server.to('user:1')`
 * reaches only the sockets THIS process holds - the same fan-out problem as
 * SSE, and it is why `NotificationStreamService` exists.
 *
 * Here the Redis subscription feeds every instance, so each one emits to
 * whichever of its own sockets are in the room. The Socket.IO-native
 * alternative is `@socket.io/redis-adapter`, which does the same thing at the
 * adapter level and also makes `server.to(...)` work cluster-wide. Both are
 * correct; using our own service keeps ONE fan-out mechanism for SSE and
 * WebSockets rather than two that can disagree.
 *
 * WHAT ELSE BREAKS AT SCALE, and the honest numbers:
 *   - MEMORY: roughly 10-40KB per idle socket, so 10,000 connections is a few
 *     hundred MB before you have done anything. Node handles it; your container
 *     limit might not.
 *   - FILE DESCRIPTORS: one per connection. The default `ulimit -n` of 1024
 *     will stop you long before memory does.
 *   - STICKY SESSIONS: Socket.IO's default transport starts with HTTP polling
 *     and upgrades, so without sticky routing the handshake can land on a
 *     different instance than the upgrade and fail intermittently. Either
 *     enable session affinity or force `transports: ['websocket']`.
 *   - DEPLOYS DISCONNECT EVERYONE. Every rolling restart drops every socket at
 *     once, and they all reconnect together - a thundering herd against your
 *     own auth endpoint. Client-side reconnect backoff with jitter is not
 *     optional.
 * =============================================================================
 */
@WebSocketGateway({
  namespace: '/realtime',
  /**
   * CORS is configured SEPARATELY from the HTTP app. `app.enableCors()` does
   * not apply to the WebSocket server - a genuinely common surprise, because
   * the browser error looks identical to an HTTP CORS failure.
   */
  cors: { origin: true, credentials: true },
})
export class NotificationsGateway
  implements OnModuleInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly stream: NotificationStreamService,
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    /**
     * ONE subscription for the whole gateway, established at startup, routing
     * each event into the room for its user.
     *
     * The alternative - subscribing per connected socket - creates N
     * subscriptions to the same source and leaks one every time a disconnect
     * handler misses an unsubscribe. One subscription plus rooms is cheaper AND
     * harder to get wrong, and per-socket filtering is unnecessary because the
     * rooms already do the routing.
     */
    this.stream.all$().subscribe({
      next: (event) => {
        this.server?.to(`user:${event.userId}`).emit('notification', event);
      },
      error: (error: unknown) => this.logger.error(`Stream error: ${describe(error)}`),
    });
  }

  /**
   * AUTHENTICATION AT THE HANDSHAKE.
   *
   * There is no global guard here: `APP_GUARD` applies to WebSocket contexts
   * too, but `JwtAuthGuard` extends Passport's HTTP `AuthGuard`, which reads
   * `request.headers` - and a Socket.IO handshake is not an Express request.
   *
   * So the token is verified explicitly, ONCE, at connection time, and the
   * result is stashed on the socket. Two consequences worth knowing:
   *
   *   1. Authentication happens once per CONNECTION, not per message - which is
   *      cheap, and which means a token that expires mid-connection does NOT
   *      end the session. For long-lived sockets you either re-verify
   *      periodically or accept that the connection outlives the token's TTL.
   *   2. Rejecting means `socket.disconnect()`. There is no 401 - the client
   *      sees a connection that closes, which is why the reason is emitted
   *      first.
   */
  async handleConnection(socket: Socket): Promise<void> {
    const token = extractToken(socket);

    if (!token) {
      socket.emit('error', { message: 'Authentication required' });
      socket.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.jwt.accessSecret,
      });

      // Attach the identity to the socket, and join the user's room.
      setUserId(socket, payload.sub);
      await socket.join(`user:${payload.sub}`);

      this.logger.debug(`Socket connected: ${socket.id} (user ${payload.sub})`);
    } catch {
      socket.emit('error', { message: 'Invalid token' });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    // Socket.IO leaves rooms automatically on disconnect; this is only for
    // visibility. Any per-socket resource YOU allocated must be released here -
    // a forgotten interval or subscription per socket is the classic
    // WebSocket memory leak.
    this.logger.debug(`Socket disconnected: ${socket.id}`);
  }

  /**
   * A genuinely bidirectional message - the thing SSE cannot do.
   *
   * Broadcast to everyone in the project room EXCEPT the sender
   * (`socket.to(...)` rather than `server.to(...)`, which is the distinction
   * people get wrong: `server.to` includes the sender and produces the "I can
   * see my own typing indicator" bug).
   */
  @SubscribeMessage('task:typing')
  handleTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { projectId?: string; taskId?: string },
  ): { ok: boolean } {
    const userId = getUserId(socket);
    if (!userId || !payload?.projectId) return { ok: false };

    socket.to(`project:${payload.projectId}`).emit('task:typing', {
      userId,
      taskId: payload.taskId,
      at: Date.now(),
    });

    // The RETURN VALUE becomes the acknowledgement callback's argument on the
    // client - Socket.IO's request/response shape, and the reason a gateway
    // handler can look exactly like a controller method.
    return { ok: true };
  }

  /** Join a project room so typing/presence events reach the right people. */
  @SubscribeMessage('project:watch')
  async handleWatch(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { projectId?: string },
  ): Promise<{ ok: boolean }> {
    if (!payload?.projectId) return { ok: false };

    /**
     * NOTE THE GAP, and it is deliberate rather than hidden: this does not
     * check that the user is a MEMBER of the project. Over HTTP that is
     * `ProjectAccessGuard`'s job, and a WebSocket message bypasses the HTTP
     * pipeline entirely.
     *
     * A production implementation must verify membership here - which is
     * exactly the argument from Phase 8 for putting authorization that must
     * hold for NON-HTTP callers into a SERVICE rather than a guard. Left
     * visible because "we forgot the socket path" is one of the most common
     * real-world authorization holes.
     */
    await socket.join(`project:${payload.projectId}`);
    return { ok: true };
  }
}

/**
 * The token can arrive three ways, in order of preference:
 *   `auth: { token }` in the client options  - the intended mechanism
 *   an `Authorization` header               - available to non-browser clients
 *   a query parameter                        - last resort, same caveats as SSE
 */
function extractToken(socket: Socket): string | undefined {
  const auth = socket.handshake.auth as { token?: string } | undefined;
  if (auth?.token) return auth.token;

  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);

  const query = socket.handshake.query as Record<string, string | string[] | undefined>;
  const fromQuery = query.access_token;

  return typeof fromQuery === 'string' ? fromQuery : undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
