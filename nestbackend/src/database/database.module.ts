import { Global, Logger, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

import { AppConfigService } from 'src/config';

import { TransactionRunner } from './transaction.runner';

/**
 * =============================================================================
 * DatabaseModule - the MongoDB connection, and nothing else
 * =============================================================================
 * This module owns the CONNECTION. Schemas and models live in the feature
 * modules that own them, registered with `MongooseModule.forFeature([...])`.
 *
 * WHY SPLIT IT THAT WAY?
 *   - `forRoot`/`forRootAsync` is called ONCE, for the connection. Calling it
 *     twice creates two connection pools, which is a real and expensive
 *     mistake.
 *   - `forFeature` is per-module and declares "this module uses these models".
 *     Keeping it next to the repository that uses it means a feature module
 *     stays self-contained: its schema, its model registration, its repository
 *     and its service move together if it is ever extracted (Phase 20).
 *
 * The same root/feature split appears throughout the Nest ecosystem
 * (TypeORM, BullMQ). Recognising the pattern is worth more than memorising
 * each library.
 * =============================================================================
 */
@Global()
@Module({
  imports: [
    /**
     * `forRootAsync` rather than `forRoot`, for one reason: the options depend
     * on `AppConfigService`, which is itself a provider. A synchronous
     * `forRoot({ uri: process.env.MONGODB_URI })` would read the environment
     * directly at module-evaluation time - before validation, unmockable, and
     * exactly the pattern Phase 1 argued against.
     *
     * This is the same distinction as `useClass` vs `useFactory` from Phase 3,
     * applied at module level: the `Async` variants exist so configuration can
     * be INJECTED.
     */
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const logger = new Logger('MongooseFactory');

        return {
          uri: config.database.uri,

          /**
           * CONNECTION POOL SIZE. Mongoose keeps a pool of sockets per process.
           * A request that arrives when every socket is busy WAITS - it does
           * not open a new connection. So an undersized pool shows up as
           * LATENCY, not errors, which makes it genuinely hard to diagnose.
           *
           * Oversizing moves the problem to the server, which has its own
           * connection ceiling and pays roughly 1MB of RAM per connection.
           *
           * Rule of thumb: maxPoolSize x number of app instances must stay
           * comfortably below the server's limit. Atlas M10, for example, caps
           * at 1500 - so 20 x 10 pods is fine, 200 x 10 is not.
           */
          maxPoolSize: config.database.maxPoolSize,
          minPoolSize: config.database.minPoolSize,

          /**
           * How long to wait for a server to be selected before failing. The
           * default is 30s, which means a request hitting a dead primary hangs
           * for 30 seconds and holds a socket the whole time. 5s fails fast
           * enough to shed load and slow enough to survive a normal replica-set
           * election (typically 1-2s).
           */
          serverSelectionTimeoutMS: 5_000,

          /**
           * Kill a query that has been running for 20 seconds. Without this, a
           * single unindexed query on a large collection can pin a connection
           * indefinitely, and enough of them exhaust the pool - which is how
           * one slow endpoint takes down every endpoint.
           */
          socketTimeoutMS: 20_000,

          /**
           * Mongoose's `autoIndex` builds indexes declared in schemas at
           * startup. Convenient in development; DANGEROUS in production,
           * because building an index on a large collection is a foreground
           * operation that can lock or severely slow the database at exactly
           * the moment your new version starts serving traffic.
           *
           * In production, indexes are created deliberately - by a migration,
           * with `background: true` / `createIndexes` run out of band, and
           * verified before the deploy. This flag is a genuinely common
           * production incident, and knowing why it is off is a strong answer.
           */
          autoIndex: !config.isProduction,

          /**
           * Connection lifecycle logging. `connectionFactory` receives the raw
           * Mongoose connection, so it is the hook for attaching listeners.
           *
           * WHY LOG THESE: a `disconnected` line at 02:14 followed by
           * `reconnected` at 02:14:07 is the difference between "the database
           * blipped" and three hours of guessing.
           */
          connectionFactory: (connection: Connection) => {
            connection.on('connected', () => logger.log('MongoDB connected'));
            connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
            connection.on('reconnected', () => logger.log('MongoDB reconnected'));
            connection.on('error', (error: Error) =>
              logger.error(`MongoDB error: ${error.message}`),
            );
            return connection;
          },
        };
      },
    }),
  ],
  providers: [TransactionRunner],

  /**
   * Re-exporting `MongooseModule` lets feature modules use
   * `MongooseModule.forFeature([...])` and inject `@InjectConnection()` without
   * importing the package's root module themselves.
   */
  exports: [MongooseModule, TransactionRunner],
})
export class DatabaseModule {}

/**
 * -----------------------------------------------------------------------------
 * WHY IS THIS ONE @Global() TOO?
 * -----------------------------------------------------------------------------
 * The same short list as config and Redis: it owns a single shared connection
 * that many unrelated modules need, it is stateless from a consumer's point of
 * view, and there is exactly one of it.
 *
 * NOTE the asymmetry with Redis, and it is deliberate: if MongoDB is
 * unavailable, this application CANNOT function - there is no correct response
 * to give - so Mongoose retries and then the process fails to boot. Redis only
 * makes us faster, so its factory degrades and carries on.
 *
 *     Fail fast on dependencies you cannot function without;
 *     degrade gracefully on dependencies that only make you faster.
 * -----------------------------------------------------------------------------
 */
