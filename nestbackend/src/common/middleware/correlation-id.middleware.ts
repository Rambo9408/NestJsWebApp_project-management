import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { RequestContextService } from '../context/request-context.service';

/** The header clients and proxies use to propagate a correlation id. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * =============================================================================
 * CLASS MIDDLEWARE - and where middleware sits in the lifecycle
 * =============================================================================
 * THE FULL PIPELINE, with this file's position marked:
 *
 *     incoming request
 *       │
 *       ├─ Express middleware (main.ts app.use)   helmet, cors, compression
 *       ├─ NEST MIDDLEWARE (module.configure)     <-- THIS FILE
 *       ├─ Guards            CanActivate          401 / 403
 *       ├─ Interceptors (pre) NestInterceptor     start the timer
 *       ├─ Pipes             PipeTransform        400
 *       ├─ ► CONTROLLER → SERVICE → DATABASE
 *       ├─ Interceptors (post)                    shape / log the response
 *       └─ Exception filters ExceptionFilter      only if something threw
 *     response
 *
 * WHY MIDDLEWARE AND NOT AN INTERCEPTOR for this job?
 * Because the store must be open for EVERYTHING that follows - including
 * guards, which run before interceptors. An interceptor would leave every
 * authentication log line without a correlation id, which is precisely the set
 * of log lines you most want correlated.
 *
 * MIDDLEWARE vs GUARD vs INTERCEPTOR, the distinction to be able to state:
 *
 *   MIDDLEWARE     runs BEFORE routing is resolved, so it does not know which
 *                  handler will run and cannot read route metadata. It sees raw
 *                  req/res. Right for anything transport-level.
 *   GUARD          runs after routing, has ExecutionContext and Reflector, and
 *                  answers yes/no.
 *   INTERCEPTOR    wraps the handler, so it sees BOTH sides and can transform
 *                  the response.
 *
 * "It has to happen before anything else, for every request" -> middleware.
 * =============================================================================
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    /**
     * TRUST AN INCOMING ID IF THERE IS ONE.
     *
     * When a gateway, a frontend or another service has already assigned an id,
     * reusing it is what makes a trace span services - the whole point of
     * DISTRIBUTED tracing. Generating a fresh one here would break the chain at
     * our boundary.
     *
     * SECURITY NOTE: this is a client-supplied header, so it must be treated as
     * untrusted data. It is only ever used as a log field, never in a query, a
     * file path or an HTML response - and it is length-capped below, because an
     * attacker who can write a 10MB string into every log line has found a
     * cheap denial-of-service against your log bill.
     *
     * In production behind a gateway you would go further and only honour the
     * header from trusted upstreams - the same reasoning as `trust proxy`.
     */
    /**
     * PHASE 18: ADOPT AN ID THAT HAS ALREADY BEEN ASSIGNED.
     *
     * `pino-http` also assigns a request id (`genReqId` in logging.module.ts),
     * and whichever of the two runs first sets the response header. Reading it
     * back here is what stops the two from minting DIFFERENT ids for the same
     * request - a bug that is invisible in tests and obvious the moment you
     * read a real log stream, because the interceptor's line and pino's line
     * carry different values.
     *
     * The rule: exactly one place may MINT the id; everything else ADOPTS it.
     * The response header is the handoff, because both sides can see it and it
     * is what the client is told.
     */
    const alreadyAssigned = response.getHeader(REQUEST_ID_HEADER);
    const incoming = request.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof alreadyAssigned === 'string' && alreadyAssigned.length > 0
        ? alreadyAssigned
        : typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
          ? incoming
          : randomUUID();

    // Echo it back so the CLIENT can quote it in a bug report. "Please include
    // the request id from the response header" turns an unreproducible ticket
    // into a log query.
    response.setHeader(REQUEST_ID_HEADER, requestId);

    /**
     * `next()` is called INSIDE `run()`, and that is the whole mechanism: every
     * async continuation created after this point - guards, pipes, the handler,
     * the database driver's callbacks - inherits the store.
     *
     * Calling `next()` outside would compile, run, and silently give every
     * downstream lookup `undefined`.
     */
    this.requestContext.run({ requestId, startedAt: Date.now() }, () => next());
  }
}

/**
 * =============================================================================
 * FUNCTIONAL MIDDLEWARE - the other form
 * =============================================================================
 * Nest accepts a plain `(req, res, next)` function anywhere it accepts a
 * middleware class. Identical to Express middleware, because it IS Express
 * middleware.
 *
 *     WHEN TO USE A CLASS:     it needs dependency injection, or it has state
 *                              or configuration worth naming.
 *     WHEN TO USE A FUNCTION:  it is a few lines and depends on nothing.
 *
 * The rule is just "does it need the container?". A function that needs a
 * service has to close over a module-level import, which is the pattern DI
 * exists to remove.
 *
 * This one is deliberately trivial: a header that tells a load balancer never
 * to cache API responses.
 */
export function noStoreMiddleware(_req: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  next();
}
