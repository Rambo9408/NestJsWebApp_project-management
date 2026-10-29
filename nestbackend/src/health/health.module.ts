import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { ProcessHealthIndicator } from './indicators/process.health';
import { RedisHealthIndicator } from './indicators/redis.health';

/**
 * =============================================================================
 * HealthModule
 * =============================================================================
 * `TerminusModule` supplies `HealthCheckService` and the built-in indicators
 * (`MongooseHealthIndicator`, `MemoryHealthIndicator`, `DiskHealthIndicator`,
 * `HttpHealthIndicator`, ...) plus `HealthIndicatorService` for custom ones.
 *
 * NOTE WHAT IS NOT IMPORTED HERE: `RedisModule`. It is `@Global()`, so
 * `REDIS_CLIENT` is injectable anywhere without an import - the same treatment
 * config, the database connection and `CommonModule` get, and for the same
 * reason: exactly one instance, cross-cutting, needed almost everywhere.
 *
 * `MongooseHealthIndicator` likewise needs no import here, because
 * `MongooseModule.forRootAsync` in `DatabaseModule` registers the connection
 * globally.
 *
 * TERMINUS ALSO PROVIDES A SHUTDOWN HOOK - `GracefulShutdownModule` - which
 * makes readiness report DOWN for a configurable window before the process
 * begins closing. That closes a real race during a rolling deploy: the load
 * balancer's health check runs on an interval, so between `SIGTERM` and the
 * balancer noticing, traffic is still being routed to a process that is already
 * shutting down. Deliberately not enabled here because it only demonstrates
 * itself behind a real load balancer - but naming the race is the answer worth
 * having.
 * =============================================================================
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [ProcessHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
