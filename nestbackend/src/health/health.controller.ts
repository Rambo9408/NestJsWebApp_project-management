import { Controller, Get, UseFilters, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MemoryHealthIndicator,
  MongooseHealthIndicator,
} from '@nestjs/terminus';

import { Public } from 'src/auth/decorators/public.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/role.enum';

import { HealthCheckExceptionFilter } from './health-check.filter';
import { ProcessHealthIndicator } from './indicators/process.health';
import { RedisHealthIndicator } from './indicators/redis.health';

/**
 * =============================================================================
 * LIVENESS vs READINESS - the distinction that prevents self-inflicted outages
 * =============================================================================
 * These are not two names for the same thing, and conflating them is one of the
 * most expensive mistakes in a containerised deployment.
 *
 *   LIVENESS   "Is this process alive, or is it wedged?"
 *              FAILING IT MEANS: the orchestrator KILLS AND RESTARTS the
 *              container.
 *              Therefore it must check ONLY the process itself. No database, no
 *              Redis, no downstream HTTP call.
 *
 *   READINESS  "Can this instance serve traffic RIGHT NOW?"
 *              FAILING IT MEANS: the load balancer stops routing to it. The
 *              process keeps running and keeps being probed.
 *              Therefore it CAN check dependencies.
 *
 * THE FAILURE MODE, concretely. Put a MongoDB check in the liveness probe, and
 * when the database has a 30-second blip:
 *
 *   1. Every instance fails liveness simultaneously.
 *   2. Kubernetes restarts ALL of them - they were perfectly healthy.
 *   3. They all reconnect at once, hammering the database that was already
 *      struggling.
 *   4. The blip becomes a total outage, and a restart loop that outlives it.
 *
 * With the split done correctly, the same blip removes the instances from the
 * load balancer, they keep running, they reconnect when the database recovers,
 * and traffic returns by itself. **No human involved, and no data loss.**
 *
 * THE THIRD PROBE, worth naming because it fixes a real problem: a STARTUP
 * probe. Kubernetes uses it to hold off the liveness probe until the app has
 * finished booting, so a slow start is not mistaken for a hang. Without it you
 * must set `initialDelaySeconds` high enough for the worst boot - which also
 * delays detection of a real hang by that same amount.
 * =============================================================================
 */
/**
 * `version: VERSION_NEUTRAL` is the second half of the stable-path decision
 * made in main.ts. `exclude` drops the `/api` prefix; this drops the `/v1`.
 * Together they give infrastructure `/health/live` - a path that survives every
 * future prefix and version change.
 *
 * NOTE THE FORM: `@Version()` is a METHOD decorator only, so a controller-wide
 * version has to go in the `@Controller({ path, version })` options object.
 * Putting `@Version()` on the class is a compile error, and the message
 * ("expects 3 arguments") does not point at the fix.
 *
 * A PROBE IS NOT A PUBLIC API, which is the justification: versioning exists so
 * that CLIENTS can migrate at their own pace. The only consumer here is your own
 * platform, and it wants one stable path forever.
 */
/**
 * =============================================================================
 * `@SkipThrottle()` - PROBES MUST NEVER BE RATE LIMITED
 * =============================================================================
 * This is not a convenience. A rate-limited liveness probe is a self-inflicted
 * outage with a feedback loop, and this application had one:
 *
 *   The Docker HEALTHCHECK polls /health/live every 30 seconds. A misconfigured
 *   global throttler capped every route at 10 requests per 15 minutes. The
 *   probe exhausted its own budget about five minutes after boot, then received
 *   429 forever. `docker inspect` showed `unhealthy`, failing streak 11.
 *
 * THE FEEDBACK LOOP is what makes it dangerous rather than merely annoying. In
 * an orchestrator, a failed liveness probe RESTARTS the container. So:
 *
 *   traffic rises -> budget is consumed faster -> probe is throttled ->
 *   container is killed -> the survivors take its traffic -> they are
 *   throttled sooner -> the whole deployment collapses under load it could
 *   otherwise have served.
 *
 * The limit designed to protect the service is what takes it down, and it does
 * so precisely when the service is most needed. That is the worst possible
 * shape for a failure.
 *
 * THE GENERAL RULE: a request from your own platform is not traffic. Probes,
 * scrape endpoints and readiness checks are control plane, and the control
 * plane must not compete with users for a shared budget.
 *
 * IS SKIPPING IT AN ABUSE VECTOR? An unauthenticated, unlimited endpoint is
 * worth thinking about - but /health/live returns a fixed object and touches
 * nothing, so flooding it is no cheaper than flooding a 404. /health/detail
 * DOES touch Mongo and Redis, which is why the exposure question belongs there
 * rather than here; in a real deployment it should not be reachable from the
 * internet at all.
 * =============================================================================
 */
@SkipThrottle()
@ApiTags('health')
@UseFilters(HealthCheckExceptionFilter)
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly processIndicator: ProcessHealthIndicator,
  ) {}

  /**
   * ---------------------------------------------------------------------------
   * LIVENESS - deliberately almost empty
   * ---------------------------------------------------------------------------
   * IT CHECKS NOTHING - deliberately. The test for whether something belongs in
   * a liveness probe is: **"if this fails, is RESTARTING THE PROCESS the right
   * response?"** Almost nothing passes that test. See the long note in
   * `indicators/process.health.ts` for why even the memory check was moved out
   * to `/health/detail`.
   *
   * THE HONEST CAVEAT: if the event loop is genuinely blocked, this endpoint
   * cannot answer at all - so the probe fails by TIMEOUT rather than by
   * returning an error. That is the correct outcome, and it is also why an HTTP
   * liveness probe detects a wedged event loop at all: an HTTP handler that
   * never runs is indistinguishable from a dead process, which for this purpose
   * is exactly right.
   *
   * `@Public()` because a probe that needs a token is useless to the
   * infrastructure - the load balancer has no credentials and should not.
   * (Note this is the one place where "unauthenticated" is deliberate rather
   * than an oversight: the endpoint exposes no data beyond up/down.)
   */
  @Public()
  @Get('live')
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness probe: is the process alive? Never touches a dependency.',
  })
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.processIndicator.isAlive('process')]);
  }

  /**
   * ---------------------------------------------------------------------------
   * READINESS - checks the dependencies, but only the ones that matter
   * ---------------------------------------------------------------------------
   * MONGODB IS REQUIRED. Without it there is no correct response to give, so an
   * instance that cannot reach it must be taken out of rotation.
   *
   * REDIS IS DELIBERATELY *NOT* HERE, and this is the interesting decision.
   *
   * Phase 10 made every Redis dependency degrade rather than fail: a cache miss
   * reads MongoDB, the throttler falls back to permitting, queued work falls
   * back to inline execution. So an instance with no Redis is SLOWER, not
   * WRONG - and removing every instance from the load balancer because the
   * cache is down converts a performance problem into a total outage.
   *
   * That is the same rule as the boot-time decision in `redis.module.ts`:
   *
   *     Fail fast on dependencies you cannot function without.
   *     Degrade gracefully on dependencies that only make you faster.
   *
   * BUT DEGRADATION MUST BE VISIBLE, which is what `/health/detail` below is
   * for. A silent fallback is how a cache that has been down for three weeks
   * gets discovered by the database bill.
   *
   * NOTE ALSO WHAT IS NOT CHECKED: downstream third-party APIs. Including one
   * means their outage takes YOUR service out of rotation - you have handed a
   * vendor the ability to page your on-call. Check them in the detail endpoint
   * and alert on them; do not gate readiness on them.
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe: can this instance serve traffic? Checks required dependencies only.',
  })
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      /**
       * The Mongoose indicator runs `db.admin().ping()` under a timeout.
       *
       * THE TIMEOUT IS THE POINT. Mongoose queues operations while
       * disconnected, so without one this check would sit in the buffer until
       * `serverSelectionTimeoutMS` expires - and the probe would hang rather
       * than fail. 1500ms is comfortably above a healthy round trip and well
       * below any sensible probe timeout.
       */
      () => this.mongoose.pingCheck('mongodb', { timeout: 1_500 }),
    ]);
  }

  /**
   * ---------------------------------------------------------------------------
   * DETAIL - everything, including the optional dependencies
   * ---------------------------------------------------------------------------
   * NOT a probe. This is for humans and for the monitoring system: it reports
   * Redis too, so a degraded cache is observable instead of silent.
   *
   * IT RETURNS 503 WHEN REDIS IS DOWN, which is exactly why it must not be
   * wired to the load balancer - the whole point of the readiness decision
   * above is that a Redis outage should NOT remove the instance from rotation.
   * Two endpoints, two different questions, two different consumers.
   *
   * IT REQUIRES A GLOBAL ADMIN, and this is a change from earlier phases where
   * it was `@Public()` "so the behaviour is demonstrable without a token".
   *
   * WHY IT CHANGED: the note here already said it SHOULD be authenticated,
   * because it reports internal topology - which dependencies exist, which are
   * failing, and how slow they are. That is genuine reconnaissance value: an
   * attacker learns you run Redis, learns when it is degraded, and learns the
   * best moment to apply load.
   *
   * A known gap that is documented but not closed is still a gap. Convenience
   * during development is a poor trade against an endpoint that maps your
   * infrastructure for anyone who curls it.
   *
   * NOTE /health/live AND /health/ready STAY PUBLIC, and must. A liveness probe
   * that needs a token is useless to a load balancer or a Kubernetes kubelet -
   * they hold no credentials, and an auth failure would read as an unhealthy
   * instance and take the service out of rotation. Two endpoints, two
   * audiences, two different answers about authentication.
   */
  @Roles(Role.ADMIN)
  @Get('detail')
  @HealthCheck()
  @ApiOperation({ summary: 'Full dependency report, including optional dependencies (Redis).' })
  detail(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.mongoose.pingCheck('mongodb', { timeout: 1_500 }),
      () => this.redis.isHealthy('redis'),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      /**
       * RSS, not heap: resident set size includes buffers, native allocations
       * and the code itself. A gap between a healthy heap and a growing RSS is
       * the signature of a native-side leak (open sockets, unreleased buffers)
       * that a heap check alone will never show.
       */
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
    ]);
  }
}
