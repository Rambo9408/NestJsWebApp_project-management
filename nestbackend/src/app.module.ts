import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';
import { AppService } from './app.service';
import { CacheModule } from './cache/cache.module';
import { CommonModule } from './common/common.module';
import {
  CorrelationIdMiddleware,
  noStoreMiddleware,
} from './common/middleware/correlation-id.middleware';
import { LoggingModule } from './common/logging/logging.module';
import { appMetadataProvider } from './common/providers/app-metadata.provider';
import { HealthModule } from './health/health.module';
import { CommentsModule } from './comments/comments.module';
import { AppConfigModule } from './config';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { ScopesDemoModule } from './examples/scopes/scopes-demo.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProjectsModule } from './projects/projects.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';

/**
 * =============================================================================
 * AppModule - the ROOT module
 * =============================================================================
 * Every Nest application has exactly one root module. `NestFactory.create()`
 * receives it, walks its `imports` graph, and from that graph builds the
 * complete DI container plus the HTTP router. If a module is not reachable
 * from here, it does not exist as far as the running application is concerned.
 *
 * THINK OF IT AS: the composition root. It is the one place that knows which
 * concrete pieces the application is assembled from. Everything below it
 * declares WHAT it needs, never WHERE that comes from.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS ARCHITECTURE? (brief section 3)
 * -----------------------------------------------------------------------------
 * We are building a MODULAR MONOLITH: one deployable process, but with hard
 * internal boundaries drawn by Nest modules. The folder layout mirrors those
 * boundaries.
 *
 * There are three KINDS of module in this project, and mixing them up is the
 * usual way a Nest codebase turns into spaghetti:
 *
 *   1. FEATURE MODULES - one per business capability: auth, users, projects,
 *      tasks, comments, notifications, activity-logs. Each owns its schemas,
 *      DTOs, controller, service and repository. It exports the smallest
 *      possible public API (usually just its service), keeping everything else
 *      private. A feature module maps 1:1 to a candidate microservice later.
 *
 *   2. INFRASTRUCTURE / SHARED MODULES - database, cache, queue, config,
 *      health. These wrap a technical concern (a connection, a client, a
 *      transport) behind an interface so that feature modules never talk to
 *      ioredis or the Mongo driver directly. Swapping Redis for Memcached
 *      should touch one folder, not thirty files.
 *
 *   3. THE COMMON FOLDER - cross-cutting building blocks with NO business
 *      knowledge: guards, pipes, interceptors, filters, decorators,
 *      middleware, constants. Rule of thumb: if something in `common/` has to
 *      import from a feature module, it does not belong in `common/`.
 *
 * DEPENDENCY BOUNDARIES (the rule that keeps this maintainable):
 *
 *      features  ->  infrastructure  ->  common
 *         |                                 ^
 *         +---------------------------------+
 *
 *   - Features may depend on infrastructure and common.
 *   - Infrastructure may depend on common.
 *   - common depends on NOTHING inside the app.
 *   - Feature-to-feature dependencies are allowed but must be one-directional
 *     and explicit. When two features need each other, that is the circular
 *     dependency problem, and Phase 4 shows why `forwardRef()` is the last
 *     resort rather than the fix.
 *
 * WHY NOT A CLASSIC LAYERED LAYOUT (controllers/, services/, models/)?
 * Because it groups by TECHNICAL ROLE rather than by REASON TO CHANGE. Adding
 * one field to "task" would touch four distant folders, and no directory tells
 * you what the system actually does. Grouping by feature keeps related code
 * together, keeps changes local, and - critically for section 28 - makes the
 * microservice split a `git mv` rather than a rewrite.
 *
 * WHY NOT MICROSERVICES NOW? Because you cannot draw correct service
 * boundaries before you understand the domain, and getting them wrong is far
 * more expensive to fix than moving a folder. A modular monolith gives you the
 * boundaries without the distributed-systems tax (network failures, eventual
 * consistency, distributed tracing, N deployment pipelines). Phase 20 covers
 * when and how to migrate.
 * =============================================================================
 */
@Module({
  imports: [
    /**
     * AppConfigModule must come FIRST, both here and conceptually: it is
     * @Global(), it validates the environment, and everything else needs its
     * values to configure itself.
     *
     * Import ORDER does not technically matter to Nest's resolver (the graph
     * is resolved by dependency, not by array position), but keeping
     * infrastructure above features makes the layering visible to humans.
     */
    AppConfigModule,

    /**
     * PHASE 9: the cross-cutting request pipeline - the global ValidationPipe,
     * the logging interceptor, the exception filter and the AsyncLocalStorage
     * request context. One module owns the answer to "what runs on every
     * request?".
     */
    CommonModule,

    /**
     * INFRASTRUCTURE (Phase 3): owns the shared Redis connection.
     *
     * It is deliberately NOT inside `cache/`, because three unrelated
     * subsystems need a Redis socket - caching (Phase 10), BullMQ (Phase 12)
     * and pub/sub fan-out for SSE (Phase 11). If the connection lived in
     * `cache/`, then `queue/` would have to import `cache/` just to get a
     * socket, and the dependency graph would state something false about the
     * architecture. Owning the CONNECTION separately from the USES of it keeps
     * every module's dependencies honest.
     *
     * The app boots even when Redis is down - see the reasoning in
     * `redis.module.ts`: fail fast on dependencies you cannot function without,
     * degrade gracefully on the ones that only make you faster.
     */
    /**
     * PHASE 5: the MongoDB connection. Opened once, here; feature modules
     * register their own models with MongooseModule.forFeature.
     *
     * Note the asymmetry with RedisModule below, and it is deliberate: if
     * MongoDB is unreachable the process FAILS TO BOOT, because there is no
     * correct response this API can give without it. Redis only makes us
     * faster, so it degrades instead.
     */
    DatabaseModule,

    RedisModule,

    /**
     * PHASE 10: cache-aside caching and Redis-backed rate limiting, both built
     * on the connection RedisModule owns. Registers the THIRD global guard
     * (throttling), which runs after authentication so it can key by user id.
     */
    CacheModule,

    /**
     * PHASE 12: the BullMQ CONNECTION and default job options. Feature modules
     * declare their own queues with BullModule.registerQueue - the same
     * root/feature split as MongoDB.
     */
    QueueModule,

    /**
     * PHASE 13: the in-process domain event bus.
     *
     * Registered as infrastructure, above the feature modules, because that is
     * the direction the dependencies now run: features depend on the bus, never
     * on each other. Removing the Users/Projects cycle is the concrete payoff.
     */
    EventsModule,

    // -------------------------------------------------------------------------
    // THE ROADMAP. Each line below is added by the phase named next to it, so
    // this file doubles as a table of contents for the whole project.
    // -------------------------------------------------------------------------
    // HealthModule,          // Phase 18 - terminus liveness/readiness probes
    //
    /**
     * PHASE 7: authentication. Registers a GLOBAL JwtAuthGuard via APP_GUARD,
     * so from here every route requires a token unless marked @Public().
     */
    AuthModule,

    /**
     * FEATURE MODULES (Phase 2).
     *
     * Note what AppModule does NOT know: it does not know that ProjectsModule
     * depends on UsersModule. That relationship is declared inside
     * ProjectsModule, where it belongs. The root module only has to know which
     * modules exist; Nest works out the graph.
     *
     * This is also why the order below is cosmetic - listing ProjectsModule
     * first would work identically. Nest resolves by dependency, not by
     * position. (Try it if you want the reassurance; it is a common
     * misconception that import order matters.)
     */
    UsersModule,
    ProjectsModule,
    NotificationsModule,

    /**
     * PHASE 4: a teaching endpoint (`GET /api/v1/scopes`) that makes provider
     * scopes observable - call it twice and see which instance ids change.
     *
     * Registered only outside production. Reading `process.env` here rather
     * than `AppConfigService` is the same chicken-and-egg as `envFilePath` in
     * `config.module.ts`: module metadata is evaluated before the container
     * exists, so there is nothing to inject from yet.
     *
     * `registerIf(false)` returns an EMPTY dynamic module, so in production the
     * controller is never registered and the route never exists. Shipping a
     * diagnostics endpoint that dumps internals is a habit worth not forming.
     */
    ScopesDemoModule.registerIf(process.env.NODE_ENV !== 'production'),

    TasksModule,
    CommentsModule,
    // NotificationsModule,   // Phase 11 - SSE + WebSocket delivery
    ActivityLogsModule,

    /**
     * PHASE 18: liveness/readiness probes (@nestjs/terminus) and structured
     * logging (pino).
     *
     * LoggingModule is imported LAST on purpose, though not for resolution
     * reasons - Nest resolves by dependency, not by array position. It is last
     * because it is the observability layer: everything above it is what gets
     * observed. Keeping the reading order infrastructure -> features ->
     * observability makes the layering visible without a diagram.
     */
    HealthModule,
    LoggingModule,
  ],

  /**
   * Controllers are NOT providers. They can receive injected providers, but
   * nothing can inject a controller - they sit at the edge of the graph, and
   * nothing should depend on the HTTP layer.
   */
  controllers: [AppController],

  /**
   * Providers registered here are private to AppModule unless exported. Since
   * nothing imports AppModule (it is the root), there is nothing to export.
   *
   * This is also where APP_GUARD / APP_INTERCEPTOR / APP_FILTER / APP_PIPE
   * providers will go in Phases 6, 8, 9 and 10. Those four tokens are how you
   * register a GLOBAL enhancer that can still use dependency injection -
   * `app.useGlobalGuards(new RolesGuard(...))` in main.ts cannot inject
   * anything, because you construct it yourself, outside the container. That
   * distinction is a classic interview question, and the answer is:
   *
   *     providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }]
   *
   * which registers it globally AND lets Nest inject its dependencies.
   *
   * `appMetadataProvider` (Phase 3) is a `useValue` provider - the simplest
   * recipe there is: "here is the finished object, hand it out". Nest
   * constructs nothing. See `common/providers/app-metadata.provider.ts` for the
   * two traps that come with it (evaluated at import time, and shared mutable
   * state - hence `Object.freeze`).
   */
  providers: [AppService, appMetadataProvider],
})
export class AppModule implements NestModule {
  /**
   * ===========================================================================
   * MIDDLEWARE REGISTRATION - the one thing that is NOT a provider
   * ===========================================================================
   * Guards, interceptors, pipes and filters are registered with APP_* tokens.
   * Middleware is different: it is bound by implementing NestModule and
   * configuring routes here.
   *
   * WHY THE ASYMMETRY? Because middleware runs BEFORE routing is resolved, so
   * it cannot be attached to a handler - it is attached to a PATH. That is also
   * why it has no ExecutionContext and cannot read route metadata.
   *
   * `.forRoutes()` accepts a path string, a controller class, or
   * `{ path, method }`. `.exclude()` skips paths - useful for health checks you
   * do not want to log on every probe.
   *
   * ORDER: middleware runs in the order `apply()` is called, and multiple
   * `apply()` calls run in sequence. CorrelationIdMiddleware must come first,
   * because everything after it - including the guards - expects the
   * AsyncLocalStorage store to be open.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      // A CLASS middleware (needs DI) and a FUNCTIONAL one (needs nothing),
      // side by side. See the file for when to choose which.
      .apply(CorrelationIdMiddleware, noStoreMiddleware)
      .forRoutes('*');
  }
}
