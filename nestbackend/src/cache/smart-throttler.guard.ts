import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

import { AuthenticatedUser } from 'src/auth/auth.types';

/**
 * =============================================================================
 * SmartThrottlerGuard - key by USER when we know who they are
 * =============================================================================
 * The default `ThrottlerGuard` keys by IP address, and IP is a poor identity:
 *
 *   - EVERYONE BEHIND ONE NAT SHARES IT. A whole office, a university, or a
 *     mobile carrier's CGNAT can be thousands of users on one address. Rate
 *     limiting them as a single client is a support ticket that reads "the app
 *     stopped working for our whole company at 9am".
 *   - IT IS TRIVIAL TO ROTATE. An attacker with a proxy pool has as many
 *     identities as they want, so IP-based limits barely inconvenience the
 *     people they are meant to stop.
 *   - IPv6 makes both worse - a single customer typically has a /64.
 *
 * So: key by USER ID when the request is authenticated, and fall back to IP
 * only for anonymous traffic (where there is nothing better). That gives a
 * limit that means what it says for logged-in users and a coarse safety net for
 * everyone else.
 *
 * Note this only works because guards run in order and `JwtAuthGuard` has
 * already populated `request.user` by the time this one runs.
 * =============================================================================
 */
@Injectable()
export class SmartThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Request & { user?: AuthenticatedUser }): Promise<string> {
    const userId = request.user?.id;
    if (userId) return Promise.resolve(`user:${userId}`);

    /**
     * `request.ip` is the REAL client address only because `main.ts` sets
     * `trust proxy` (Phase 1). Without it every request behind a load balancer
     * looks like it came from the balancer, and the entire user base shares one
     * bucket - which is the single most common way a rate limiter is silently
     * broken in production.
     */
    return Promise.resolve(`ip:${request.ip ?? 'unknown'}`);
  }
}
