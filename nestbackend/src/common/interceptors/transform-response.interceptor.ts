import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';

import { RequestContextService } from '../context/request-context.service';

export interface ResponseEnvelope<T> {
  success: true;
  statusCode: number;
  data: T;
  requestId?: string;
  timestamp: string;
}

/**
 * =============================================================================
 * TransformResponseInterceptor - `map()`, and a decision worth arguing about
 * =============================================================================
 * Wraps a handler's return value:
 *
 *     { "id": "1", "name": "Ada" }
 *
 *     { "success": true, "statusCode": 200, "requestId": "...",
 *       "timestamp": "...", "data": { "id": "1", "name": "Ada" } }
 *
 * MECHANICALLY it is three lines - `next.handle().pipe(map(...))`. The
 * interesting part is whether you should.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS IS **NOT** REGISTERED GLOBALLY IN THIS PROJECT
 * -----------------------------------------------------------------------------
 * Response envelopes are one of the most common "senior" patterns in tutorials
 * and one of the more contested in practice. The case against, honestly:
 *
 *   1. IT DUPLICATES HTTP. `success` restates the status code, which the client
 *      already has. `statusCode` in the body is the same number in two places -
 *      and they can disagree, at which point which one is true?
 *   2. IT BREAKS CODE GENERATION. OpenAPI/Swagger clients, and every generated
 *      SDK, expect `GET /users/:id` to return a User. An envelope means every
 *      generated type is `Envelope<User>` and every call site unwraps `.data`.
 *   3. IT ENCOURAGES 200-WITH-ERRORS. Once the body carries `success`, someone
 *      inevitably returns `200 { success: false }` - and now every client must
 *      check the body instead of the status, monitoring cannot see failures,
 *      and retry logic breaks.
 *   4. IT IS NOT FREE. Extra bytes on every response, forever.
 *
 * The case FOR: a uniform shape simplifies a hand-written client, and
 * `requestId` in the body means support can ask users to paste the response
 * rather than read a header.
 *
 * WHAT THIS PROJECT DOES - and it is the position most mature APIs (Stripe,
 * GitHub) take:
 *   - SUCCESS responses return the RESOURCE, plainly. REST-correct, works with
 *     generated clients.
 *   - ERROR responses are standardised globally by `AllExceptionsFilter`, where
 *     consistency genuinely helps, because clients have to branch on errors.
 *
 * So this interceptor is applied per-controller (see `AppController`) to
 * demonstrate the mechanism, and the reasoning above is the answer to give when
 * an interviewer asks "would you wrap all your responses?". "Yes, always" and
 * "no, never" are both weaker answers than knowing why.
 * =============================================================================
 */
@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<T, ResponseEnvelope<T>> {
  constructor(private readonly requestContext: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ResponseEnvelope<T>> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      /**
       * `map` transforms the emitted value. It runs AFTER the handler, and -
       * importantly - after any pipes and after the handler's promise resolves.
       *
       * NOTE `response.statusCode` is read INSIDE the map, not outside: by the
       * time the value is emitted, `@HttpCode()` and any `res.status()` call
       * have already been applied. Reading it before `next.handle()` would
       * capture the default and quietly report 200 for a 201.
       */
      map((data) => ({
        success: true as const,
        statusCode: response.statusCode,
        requestId: this.requestContext.requestId,
        timestamp: new Date().toISOString(),
        data,
      })),
    );
  }
}
