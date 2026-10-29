/**
 * `reflect-metadata` MUST be imported before anything that uses decorators.
 *
 * It installs the `Reflect.getMetadata` / `Reflect.defineMetadata` polyfill
 * that the whole framework is built on: `@Injectable()`, `@Controller()`,
 * `@Get()` and the compiler-emitted `design:paramtypes` all read and write
 * through it. Without this import you get a confusing
 * "Reflect.getMetadata is not a function" at startup.
 *
 * (In practice @nestjs/core imports it too, so it usually works by accident.
 * Importing it explicitly, first, makes the dependency intentional.)
 */
import 'reflect-metadata';

import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfigService } from './config';
import { setupSwagger } from './swagger';

/**
 * =============================================================================
 * BOOTSTRAP - the composition root of the process
 * =============================================================================
 * WHAT HAPPENS INSIDE NestFactory.create():
 *
 *   1. It scans the module graph starting at AppModule, recursively following
 *      `imports`.
 *   2. For each module it builds a container of providers, keyed by token.
 *   3. It resolves the dependency graph depth-first and instantiates every
 *      singleton provider exactly once (request-scoped ones are deferred until
 *      a request arrives - Phase 4).
 *   4. It calls lifecycle hooks in order: onModuleInit -> onApplicationBootstrap.
 *   5. It builds the HTTP router from controller metadata and mounts it on the
 *      underlying HTTP adapter (Express here, Fastify if you swap it).
 *
 * Note the ORDER: the entire container is wired BEFORE the server listens.
 * That is why a missing provider or an invalid environment variable crashes at
 * boot instead of on the first request. This "fail fast at startup" property is
 * one of the strongest practical arguments for Nest over hand-rolled Express.
 *
 * -----------------------------------------------------------------------------
 * WHERE main.ts SITS IN THE REQUEST LIFECYCLE (full treatment in Phase 9)
 * -----------------------------------------------------------------------------
 * Everything registered here with `app.use(...)` is EXPRESS-LEVEL middleware.
 * It runs before Nest's own pipeline even starts:
 *
 *   incoming request
 *        |
 *        v
 *   [ express middleware registered in main.ts: helmet, cors, compression,
 *     cookie-parser ]                       <-- knows nothing about Nest DI
 *        |
 *        v
 *   [ Nest middleware (configure() in a module) ]
 *        |
 *        v
 *   [ Guards ]            -> authentication / authorization  (Phase 8)
 *        |
 *        v
 *   [ Interceptors: before ]                                 (Phase 9)
 *        |
 *        v
 *   [ Pipes ]             -> validation / transformation     (Phase 6)
 *        |
 *        v
 *   [ Controller -> Service -> Database ]
 *        |
 *        v
 *   [ Interceptors: after ] -> response shaping
 *        |
 *        v
 *   [ Exception filters ] -> only if something threw         (Phase 9)
 *        |
 *        v
 *   response
 *
 * The practical consequence: anything that must run for EVERY request
 * including ones that never reach a route (404s, malformed bodies) belongs at
 * the Express level here. Anything that needs DI, per-route metadata, or the
 * ExecutionContext belongs in a Nest guard/interceptor/filter instead.
 * =============================================================================
 */
async function bootstrap(): Promise<void> {
  /**
   * The generic parameter gives us the Express-specific API surface
   * (`app.set()`, `app.useStaticAssets()`). Without it, `app` is the
   * platform-agnostic `INestApplication`.
   *
   * WHY EXPRESS AND NOT FASTIFY? Fastify is meaningfully faster on
   * JSON-throughput benchmarks, and swapping is a one-line change
   * (`FastifyAdapter`). We use Express because its middleware ecosystem is
   * larger, because the reader already knows it, and because in a real app the
   * bottleneck is almost always the database, not the HTTP parser. Revisit
   * that call only after profiling proves the framework is the constraint -
   * that reasoning itself is the senior-level answer.
   */
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Buffer log lines emitted during bootstrap so that a custom logger
    // installed later (pino, Phase 18) can still flush them in its own format
    // rather than losing them.
    bufferLogs: true,
  });

  /**
   * Reading configuration OUT of the DI container.
   *
   * `app.get(Token)` is the imperative escape hatch: it asks the container for
   * an instance by token. It is the right tool here because main.ts is outside
   * the DI graph - there is no constructor to inject into.
   *
   * COMMON MISTAKE: using `app.get()` (or a module-level `ModuleRef.get()`)
   * inside application code as a service locator. That re-hides dependencies,
   * defeats the compile-time graph, and makes testing hard again. Rule: inject
   * everywhere; use `app.get()` only in bootstrap code and in tests.
   *
   * CAVEAT: `app.get()` cannot retrieve REQUEST-scoped providers - there is no
   * request. For those you need `resolve()` (Phase 4).
   */
  const config = app.get(AppConfigService);
  const { port, apiPrefix, corsOrigins, name, nodeEnv } = config.app;

  /**
   * TRUST PROXY. In production this app sits behind a load balancer or ingress,
   * so the TCP peer address is the proxy, not the client. With this set,
   * Express reads `X-Forwarded-For` and populates `req.ip` with the real client
   * address.
   *
   * WHY IT MATTERS BEYOND LOGGING: rate limiting (Phase 10) buckets by client
   * IP. Without trust proxy every request looks like it came from the load
   * balancer, so either you rate-limit your entire user base as one client, or
   * you disable the limit. Also, `req.secure` and secure-cookie decisions
   * depend on `X-Forwarded-Proto`.
   *
   * SECURITY NOTE: `X-Forwarded-For` is a client-supplied header. Only trust it
   * when a proxy you control is guaranteed to be in front. `1` means "trust
   * exactly one hop", which is correct for a single ALB/nginx and safer than
   * `true` (trust everything).
   */
  app.set('trust proxy', 1);

  /**
   * SECURITY HEADERS. Helmet sets a bundle of defensive response headers
   * (Content-Security-Policy, X-Content-Type-Options, Strict-Transport-Security,
   * Referrer-Policy, and it removes X-Powered-By).
   *
   * For a pure JSON API the highest-value ones are `X-Content-Type-Options:
   * nosniff` and HSTS; CSP matters most when you serve HTML - which we do, for
   * Swagger UI, so Phase 15 revisits the CSP settings. Full discussion in
   * Phase 16.
   */
  app.use(helmet());

  /**
   * gzip/deflate for responses above ~1KB. Cheap win for JSON list endpoints.
   *
   * WHEN NOT TO: if TLS termination or a CDN already compresses, doing it twice
   * burns CPU for nothing. And never compress responses that mix secrets with
   * attacker-controlled input over TLS (the BREACH attack) - not a concern for
   * a token-in-header API, but it is why you think before enabling it blindly.
   */
  app.use(compression());

  /**
   * Parses the `Cookie` header into `req.cookies`. Needed in Phase 7, where the
   * refresh token is delivered as an httpOnly cookie rather than in the JSON
   * body - so that JavaScript in the browser cannot read it, which is the whole
   * defence against token theft via XSS.
   */
  app.use(cookieParser());

  /**
   * CORS. The browser enforces the same-origin policy; this header tells it
   * which origins may read our responses.
   *
   * `credentials: true` is required for cookie-based refresh tokens, and it is
   * exactly why `origin: '*'` is forbidden alongside it - the spec disallows
   * that combination, and allowing every origin to send credentials would be a
   * CSRF invitation. Hence the explicit allow-list from configuration.
   */
  app.enableCors({
    origin: corsOrigins.includes('*') ? true : corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });

  /**
   * GLOBAL PREFIX: every route is served under `/api`.
   *
   * WHY: it leaves room on the same domain for non-API routes (static assets,
   * webhooks, metrics) and makes reverse-proxy rules trivial ("route /api to
   * the backend"). Health checks are commonly EXCLUDED from the prefix so that
   * infrastructure can probe a stable `/health` path - we do that in Phase 18
   * with the `exclude` option.
   */
  /**
   * PHASE 18: THE PROBES ARE EXCLUDED FROM THE PREFIX.
   *
   * WHY: infrastructure - a Kubernetes probe, a load-balancer target group, a
   * Docker HEALTHCHECK - is configured once, in YAML, often by a different
   * team. Making that configuration depend on YOUR api prefix and YOUR version
   * number means the day you ship `/api/v2`, someone has to remember to edit an
   * ingress manifest, and if they do not, the platform declares every instance
   * unhealthy and takes the service down during a routine deploy.
   *
   *     /health/live        stable forever
   *     /api/v1/health/live coupled to two decisions that WILL change
   *
   * `exclude` removes the prefix. Removing the VERSION needs the second half:
   * `@Version(VERSION_NEUTRAL)` on the controller, because `defaultVersion`
   * otherwise applies to every route. Both are required - doing only one leaves
   * you with `/v1/health/live`, which is the worst of both.
   *
   * NOTE the paths are listed explicitly rather than as a wildcard. Nest 11 runs
   * on Express 5, whose path-to-regexp v8 changed wildcard syntax (`*` became
   * `{*splat}`); three literal strings are immune to that and to the next
   * change.
   */
  app.setGlobalPrefix(apiPrefix, {
    exclude: ['health/live', 'health/ready', 'health/detail'],
  });

  /**
   * API VERSIONING. `VersioningType.URI` puts the version in the path:
   *
   *     GET /api/v1/tasks
   *
   * `defaultVersion: '1'` means a controller without an explicit @Version()
   * is served as v1. To ship a breaking change you add a second controller
   * with `@Version('2')` and run both side by side while clients migrate.
   *
   * ALTERNATIVES Nest supports and their trade-offs:
   *   - HEADER  (`X-API-Version: 2`): keeps URLs stable and clean, but is
   *     invisible in logs and browser address bars and harder to test by hand.
   *   - MEDIA_TYPE (`Accept: application/json;v=2`): the most RESTfully pure
   *     option, and the one real-world clients get wrong most often.
   *   - CUSTOM: your own extractor function.
   * URI versioning wins on debuggability, which in practice beats purity. The
   * senior point to make in an interview: versioning is a promise about
   * BACKWARD COMPATIBILITY, and the cheapest version is the one you never cut -
   * prefer additive, non-breaking changes first.
   */
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  /**
   * GRACEFUL SHUTDOWN. Enables Nest's listeners for SIGTERM/SIGINT so that
   * `onModuleDestroy` / `beforeApplicationShutdown` / `onApplicationShutdown`
   * hooks actually run.
   *
   * WHY THIS IS NOT OPTIONAL IN PRODUCTION: when Kubernetes or ECS rolls out a
   * new version it sends SIGTERM. Without hooks the process dies immediately,
   * killing in-flight HTTP requests, leaving Mongo/Redis sockets open and -
   * worst of all - abandoning half-processed BullMQ jobs, which then have to
   * wait for their lock to expire before another worker retries them. With
   * hooks, our modules close connections and drain workers first (Phase 12).
   *
   * COST: Nest attaches process signal listeners; harmless here. It is off by
   * default only because some serverless environments dislike it.
   */
  app.enableShutdownHooks();

  // ---------------------------------------------------------------------------
  // THE ROADMAP for this file. Each item is added by the phase noted, and each
  // is deliberately NOT here yet so you can see the pipeline grow one concept
  // at a time.
  // ---------------------------------------------------------------------------
  // Phase 6  : app.useGlobalPipes(new ValidationPipe({ whitelist: true, ... }))
  //            (registered via APP_PIPE in AppModule so it can inject.)
  // Phase 9  : app.useGlobalFilters(new AllExceptionsFilter())
  //            app.useGlobalInterceptors(new TransformResponseInterceptor())

  /**
   * PHASE 18: REPLACE NEST'S LOGGER WITH PINO.
   *
   * `app.get(PinoLogger)` pulls the logger service out of the container -
   * `LoggingModule` configured it, so it already knows the level, the redaction
   * rules and the transport. `useLogger` then makes it the logger the FRAMEWORK
   * uses, which is the part people miss: without this line, `new Logger()`
   * inside your services writes structured JSON only if you injected pino
   * directly, while every framework line (route mapping, shutdown, Mongoose
   * connection) still prints in the default format. Two formats in one stream is
   * worse than either.
   *
   * THIS PAIRS WITH `bufferLogs: true` IN `NestFactory.create`. Logs emitted
   * during bootstrap - before this line runs - are held in a buffer and flushed
   * through pino once it is installed. Without buffering they are printed in the
   * default format and, more importantly, a crash during module initialisation
   * produces output your log aggregator cannot parse - which is precisely when
   * you need it most.
   */
  app.useLogger(app.get(PinoLogger));

  /**
   * PHASE 15: OpenAPI. Registered AFTER the global prefix and versioning so the
   * documented paths match the real ones - a surprisingly common mistake is to
   * set Swagger up first and publish a document describing routes that do not
   * exist.
   */
  setupSwagger(app, config);

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`${name} running in ${nodeEnv} mode`);
  logger.log(`HTTP server listening on http://localhost:${port}/${apiPrefix}/v1`);
}

/**
 * WHY THE EXPLICIT `.catch()`?
 *
 * `bootstrap()` returns a promise. An unhandled rejection in Node 15+
 * terminates the process with a stack trace that often hides the real cause
 * (for example a Joi validation error). Catching it lets us log something
 * readable and exit with a NON-ZERO status code, which is what tells Docker,
 * Kubernetes and CI that the container failed rather than finished.
 *
 * `process.exit(1)` here is correct precisely because nothing is running yet -
 * there are no in-flight requests to drain. Calling it in normal operation
 * would be the opposite of graceful shutdown.
 */
void bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error);
  process.exit(1);
});
