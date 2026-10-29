import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import { AppConfigService } from 'src/config';

import { REQUEST_ID_HEADER } from '../middleware/correlation-id.middleware';

/**
 * =============================================================================
 * STRUCTURED LOGGING
 * =============================================================================
 * WHY REPLACE THE BUILT-IN LOGGER AT ALL?
 *
 * Nest's default logger prints coloured, human-readable lines. That is perfect
 * in a terminal and useless in production, because production logs are not read
 * by a human scrolling - they are INGESTED by Loki, CloudWatch, Datadog or
 * Elasticsearch and then QUERIED.
 *
 *   Human-readable:  [Nest] 1234  - 08/19/2026, 4:31:22 PM  LOG [UsersService] created user 68f...
 *   Structured:      {"level":30,"time":1755622282,"context":"UsersService",
 *                     "requestId":"c1f...","userId":"68f...","msg":"created user"}
 *
 * The second one lets you ask *"show me every error for user X in the last
 * hour, grouped by endpoint"*. The first one lets you grep, and grep across
 * twelve instances is not an observability strategy.
 *
 * WHY PINO SPECIFICALLY: it is the fastest Node logger by a wide margin, and
 * the reason is architectural rather than micro-optimisation - it serialises to
 * JSON with minimal work and, with `transport`, moves formatting to a SEPARATE
 * WORKER THREAD. Winston formats on the main thread, so pretty-printing costs
 * you event-loop time on every log line. At a few thousand requests a second
 * that is a real, measurable difference.
 *
 * THE COST, honestly: JSON logs are unpleasant to read raw during local
 * development, which is exactly why `pino-pretty` is wired in below for
 * non-production - and never in production, where it would burn CPU rendering
 * output no human will read.
 * =============================================================================
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.app.logLevel,

          /**
           * -------------------------------------------------------------------
           * THE CORRELATION ID - the single highest-value field in the record
           * -------------------------------------------------------------------
           * `genReqId` decides the value pino attaches to EVERY line produced
           * during a request, so it is where our existing correlation id has to
           * be joined up.
           *
           * The logic mirrors `CorrelationIdMiddleware`: honour an incoming
           * `x-request-id` so a trace SPANS SERVICES, otherwise mint one. That
           * propagation is the difference between "the checkout failed" and
           * "the checkout failed here, because payments timed out there".
           *
           * The response header is set here too, so a client can quote the id
           * in a bug report - which turns an unreproducible ticket into a log
           * query.
           */
          /**
           * THE PARAMETER TYPES ARE `IncomingMessage`/`ServerResponse`, not
           * Express's `Request`/`Response`, because `pino-http` is framework
           * agnostic - it works with a bare `http` server. The narrowing here is
           * safe (this app runs on Express) but it has to be explicit, and the
           * compiler error when you get it wrong is a wall of generics.
           */
          genReqId: (rawReq: IncomingMessage, rawRes: ServerResponse): string => {
            const req = rawReq as Request;
            const res = rawRes as unknown as Response;

            /**
             * -----------------------------------------------------------------
             * A BUG FOUND BY RUNNING THE SERVER, not by a test
             * -----------------------------------------------------------------
             * The first version of this function generated an id whenever the
             * client did not send one. So did `CorrelationIdMiddleware`. Both
             * ran, so a single request produced TWO ids:
             *
             *     interceptor log line   req=7266d233-...
             *     pino log line          req.id=b1f28ceb-...
             *     response header        whichever ran last
             *
             * Every line was tagged - with the wrong tag half the time. That is
             * WORSE than no correlation id, because the field looks trustworthy
             * and quietly splits one request into two traces.
             *
             * THE FIX IS THE PATTERN, not the patch: **whoever runs first owns
             * the id, and everyone else adopts it.** The response header is the
             * shared handoff point, because it is the one piece of state both
             * sides can already see, and it is the value the client is told.
             * `CorrelationIdMiddleware` does the same check in the same order,
             * so the two agree regardless of which Express registers first -
             * which matters, because that order is decided by nestjs-pino's
             * internals, not by us.
             *
             * THE GENERAL LESSON: two components that each "helpfully" generate
             * a missing value will silently disagree. Exactly one place may mint
             * it.
             */
            const existing = res.getHeader(REQUEST_ID_HEADER);
            if (typeof existing === 'string' && existing.length > 0) return existing;

            const incoming = req.headers[REQUEST_ID_HEADER];
            const id =
              typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
                ? incoming
                : randomUUID();

            res.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },

          /**
           * -------------------------------------------------------------------
           * REDACTION - the part that is not optional
           * -------------------------------------------------------------------
           * Without this, `autoLogging` writes the whole request header block,
           * which means EVERY LOG LINE CONTAINS A BEARER TOKEN AND A SESSION
           * COOKIE. Logs are then a credential store: replicated, retained for
           * a year, shipped to a vendor, and readable by everyone with a
           * dashboard login.
           *
           * This is one of the most common real-world leaks, and it happens by
           * default rather than by mistake - which is why it is worth being
           * emphatic about.
           *
           * Pino's `redact` uses fast pre-compiled paths, so this is cheap. The
           * bracket syntax escapes the dashes in header names.
           */
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-csrf-token"]',
              'res.headers["set-cookie"]',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
              'req.body.refreshToken',
            ],
            censor: '[REDACTED]',
          },

          /**
           * -------------------------------------------------------------------
           * SERIALISERS - trim what is logged per request
           * -------------------------------------------------------------------
           * pino-http's defaults log the entire request and response objects.
           * That is a lot of bytes per line, and log volume is a real bill: at
           * 1000 req/s, 2KB per line is ~170GB a day.
           *
           * The fields kept are the ones you actually query on. Note `id` is
           * included so the correlation id appears on the summary line too, not
           * only on lines emitted inside the handler.
           */
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },

          /**
           * -------------------------------------------------------------------
           * LOG LEVEL BY OUTCOME
           * -------------------------------------------------------------------
           * The default is `info` for everything, which makes a 500 and a 200
           * equally loud - so nobody can alert on "errors" without also alerting
           * on success.
           *
           * The split below is the one that matters operationally:
           *   5xx -> error   OUR fault. Alert on these.
           *   4xx -> warn    the CLIENT's fault. Interesting in aggregate (a
           *                  spike in 401s is an attack or a broken deploy), but
           *                  not individually actionable.
           *   2xx -> info
           *
           * The mistake to avoid is logging 4xx at `error`: your error rate then
           * tracks how many people mistype their password, and the alert becomes
           * noise everyone mutes.
           */
          customLogLevel: (_req, res, err) => {
            if (err) return 'error';
            if (res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },

          customSuccessMessage: (req, res) =>
            `${req.method ?? 'GET'} ${req.url ?? '/'} ${res.statusCode}`,

          /**
           * -------------------------------------------------------------------
           * autoLogging: one line per request, automatically
           * -------------------------------------------------------------------
           * DISABLED IN TESTS, where it is pure noise around the assertion that
           * actually failed.
           *
           * The health probes are excluded ALWAYS. Kubernetes probes every
           * instance every ten seconds; over a day, on ten instances, that is
           * ~250,000 log lines that say "the app is up" - drowning the signal
           * and costing real money in a per-GB ingestion plan.
           *
           * NOTE THIS DUPLICATES SOME OF `LoggingInterceptor` (Phase 9). That is
           * a deliberate, documented overlap rather than an oversight: the
           * interceptor logs from INSIDE the Nest pipeline, so it sees the
           * handler, the controller class and the resolved user; pino-http logs
           * from OUTSIDE it, so it also catches requests that never reach a
           * handler at all - 404s, and anything a middleware rejects. In a real
           * project you would pick one; keeping both here shows what each layer
           * can and cannot see.
           */
          autoLogging: config.isTest
            ? false
            : {
                ignore: (req: IncomingMessage) => req.url?.includes('/health') === true,
              },

          /**
           * -------------------------------------------------------------------
           * pino-pretty in development ONLY
           * -------------------------------------------------------------------
           * `transport` runs the formatter in a WORKER THREAD, so pretty-printing
           * does not block the event loop. That is the whole reason this is safe
           * to enable at all.
           *
           * In production: no transport. Write JSON to stdout and let the
           * platform collect it - the twelve-factor rule, and the reason is that
           * an app writing its own log files has to solve rotation, disk limits,
           * and shipping, all of which the platform already solves.
           */
          /**
           * ALSO OFF IN TESTS - a worker thread per suite is pure overhead when
           * `autoLogging` is already disabled and nobody reads the output.
           *
           * WORTH KNOWING, because it is the kind of thing that gets blamed on
           * the wrong component: a transport IS a real worker thread, so it
           * needs a shutdown story or a test runner will report a leaked
           * handle. (This repository does emit Jest's *"a worker process has
           * failed to exit gracefully"* warning - but it predates this module
           * and still appears with the logging suite excluded, so it is not
           * pino. The general rule stands: anything spawning a thread, timer or
           * socket needs a teardown path - compare the `.unref()` on the Redis
           * probe timeout.)
           */
          transport:
            config.isProduction || config.isTest
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    ignore: 'pid,hostname',
                  },
                },
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
