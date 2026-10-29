import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';
import { Error as MongooseError } from 'mongoose';

import { RequestContextService } from '../context/request-context.service';

/** The one error shape this API ever returns. */
export interface ErrorResponse {
  success: false;
  statusCode: number;
  /** A string, or an array of them for validation failures. */
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
  /** Quote this in a bug report and support can find the exact request. */
  requestId?: string;
}

/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/**
 * =============================================================================
 * AllExceptionsFilter - one shape for every failure
 * =============================================================================
 * `@Catch()` with NO argument catches everything. `@Catch(HttpException)` would
 * catch only those, which is the more common form for a specialised filter.
 *
 * WHERE FILTERS SIT: last. If anything in the pipeline throws - a guard, a
 * pipe, the handler, an interceptor - the exception unwinds to here, and this
 * decides what the client sees.
 *
 * EXPRESS COMPARISON: `app.use((err, req, res, next) => ...)`, the four-argument
 * error handler. What a Nest filter adds is `ArgumentsHost` (so the same filter
 * can serve HTTP, WebSocket and RPC), dependency injection, and per-scope
 * registration (global / controller / route) instead of one global handler.
 *
 * -----------------------------------------------------------------------------
 * WHY A CONSISTENT ERROR SHAPE IS WORTH MORE THAN A CONSISTENT SUCCESS SHAPE
 * -----------------------------------------------------------------------------
 * Clients have to BRANCH on errors: show a message, retry, log out, or give up.
 * A payload that is `{message}` here, `{error}` there and a raw HTML stack trace
 * from an unhandled case forces every client to write defensive parsing.
 *
 * Success responses have no such problem - the client asked for a user and got
 * a user. That is exactly why this project standardises errors globally and
 * leaves success responses as plain resources (see
 * `transform-response.interceptor.ts`).
 *
 * -----------------------------------------------------------------------------
 * THE SECURITY RULE THIS FILE EXISTS TO ENFORCE
 * -----------------------------------------------------------------------------
 * NEVER let an unexpected error's message reach the client. A raw database
 * error can contain a connection string, a collection name, a query with real
 * data in it, or a file path that reveals your directory layout - and a stack
 * trace hands an attacker your dependency versions.
 *
 * So: KNOWN errors (HttpException, and the database errors we deliberately
 * translate) keep their message. Everything else becomes a flat "Internal
 * server error" for the client and a FULL log line for us, joined by the
 * request id. The user gets nothing useful to an attacker; the engineer gets
 * everything.
 * =============================================================================
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(
    /**
     * `HttpAdapterHost` rather than `response.json()` directly.
     *
     * It gives the platform-agnostic adapter, so this filter works unchanged if
     * the application swaps Express for Fastify. It also matters in ONE
     * practical case the Nest docs call out: during bootstrap the response
     * object may not be fully initialised, and the adapter handles that.
     */
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly requestContext: RequestContextService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;

    /**
     * A filter can be entered from a non-HTTP context (a WebSocket gateway, a
     * microservice handler). Writing an HTTP response there would throw inside
     * the error handler - the worst place for a second error.
     */
    if (host.getType() !== 'http') {
      this.logger.error(`Non-HTTP exception: ${describe(exception)}`);
      return;
    }

    const context = host.switchToHttp();
    const request = context.getRequest<Request>();

    const { status, message, error, isExpected } = this.classify(exception);

    const body: ErrorResponse = {
      success: false,
      statusCode: status,
      message,
      error,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
      requestId: this.requestContext.requestId,
    };

    /**
     * LOG LEVEL BY CLASS, and the stack ONLY for unexpected errors.
     *
     *   5xx / unknown -> error + full stack. This is ours to fix.
     *   4xx           -> debug. A client sending bad input is not an incident,
     *                    and logging it at warn/error makes the error dashboard
     *                    useless - a bot probing for /wp-admin should not look
     *                    like an outage.
     */
    // `HttpStatus.INTERNAL_SERVER_ERROR` is a TypeScript enum, and comparing a
    // plain `number` to an enum member trips `no-unsafe-enum-comparison` - a
    // rule worth keeping, because enum/number mix-ups are a real source of
    // silent bugs. The numeric literal states the intent unambiguously.
    if (status >= 500 || !isExpected) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${status} req=${body.requestId ?? 'none'}`,
        exception instanceof Error ? exception.stack : describe(exception),
      );
    } else {
      this.logger.debug(
        `${request.method} ${request.originalUrl} -> ${status}: ${String(message)}`,
      );
    }

    httpAdapter.reply(context.getResponse(), body, status);
  }

  /**
   * Turn an unknown thrown value into a status, a safe message and a label.
   *
   * The ORDER of these checks matters: most specific first. `HttpException`
   * before `Error`, and the Mongoose cases before the catch-all - otherwise a
   * `ValidationError` (which IS an Error) would be reported as a 500.
   */
  private classify(exception: unknown): {
    status: number;
    message: string | string[];
    error: string;
    isExpected: boolean;
  } {
    /**
     * 1. Anything we threw deliberately: NotFoundException, ConflictException,
     *    the ValidationPipe's BadRequestException, and so on.
     *
     * `getResponse()` returns either a string or an object. The ValidationPipe
     * returns `{ message: string[], error, statusCode }`, and preserving that
     * ARRAY is what lets a frontend show one message per field. Flattening it
     * to a string here is a small change that makes forms noticeably worse.
     */
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const status = exception.getStatus();

      if (typeof response === 'string') {
        return { status, message: response, error: exception.name, isExpected: true };
      }

      const payload = response as { message?: string | string[]; error?: string };

      return {
        status,
        message: payload.message ?? exception.message,
        error: payload.error ?? exception.name,
        isExpected: true,
      };
    }

    /**
     * 2. A Mongoose CastError - "abc" where an ObjectId was expected.
     *
     * `ParseObjectIdPipe` catches this at the edge for route params, but ids
     * also arrive from queue payloads and other services. Left unclassified it
     * is a 500: a CLIENT mistake recorded as a SERVER error, which corrupts
     * your error budget and your alerting.
     */
    if (exception instanceof MongooseError.CastError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: `Invalid value for "${exception.path}"`,
        error: 'Bad Request',
        isExpected: true,
      };
    }

    if (exception instanceof MongooseError.ValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: Object.values(exception.errors).map((detail) => detail.message),
        error: 'Bad Request',
        isExpected: true,
      };
    }

    /**
     * 3. A unique-index violation.
     *
     * The repositories already translate the ones they expect; this is the
     * safety net for paths that do not, so a race on a unique index produces
     * 409 rather than 500. Note the message is DELIBERATELY GENERIC - the
     * driver's own message includes the index name and the conflicting VALUE,
     * which can be someone's email address.
     */
    if (isDuplicateKeyError(exception)) {
      return {
        status: HttpStatus.CONFLICT,
        message: 'A record with these details already exists',
        error: 'Conflict',
        isExpected: true,
      };
    }

    /**
     * 4. Everything else. The client gets nothing; the log gets everything.
     */
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
      isExpected: false,
    };
  }
}

function isDuplicateKeyError(exception: unknown): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'code' in exception &&
    (exception as { code?: number }).code === DUPLICATE_KEY
  );
}

function describe(exception: unknown): string {
  if (exception instanceof Error) return `${exception.name}: ${exception.message}`;
  return typeof exception === 'string' ? exception : JSON.stringify(exception);
}
