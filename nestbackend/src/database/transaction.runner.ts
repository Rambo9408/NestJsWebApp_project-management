import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';

/**
 * =============================================================================
 * TransactionRunner - one place that knows how to run a MongoDB transaction
 * =============================================================================
 * WHAT IS A TRANSACTION IN MONGODB?
 * A single document write is already atomic - that has always been true, and it
 * is why most MongoDB applications need no transactions at all. What is NOT
 * atomic is writing to SEVERAL documents or collections and needing all-or-
 * nothing. Deleting a task and its comments is exactly that: without a
 * transaction, a crash between the two writes leaves orphaned comments
 * pointing at a task that no longer exists.
 *
 * REQUIREMENTS, and the reason `docker-compose.yml` runs a replica set even for
 * one node: transactions need a replica set (or a sharded cluster). On a
 * standalone `mongod` you get
 *
 *     Transaction numbers are only allowed on a replica set member or mongos
 *
 * at RUNTIME - which is why developing against a standalone and deploying
 * against a replica set is a genuinely nasty trap.
 *
 * WHY WRAP IT IN A PROVIDER?
 *   1. `withTransaction` already handles retries for transient errors
 *      (`TransientTransactionError`, `UnknownTransactionCommitResult`) - but
 *      the session still has to be ended in a `finally`, and forgetting that
 *      leaks a session per call.
 *   2. It is one seam. If we ever need transaction logging, metrics, or a
 *      "transactions disabled in this environment" switch, it goes here.
 *   3. It is injectable, so a unit test can substitute a runner that just calls
 *      the callback with `undefined` - no database needed.
 *
 * -----------------------------------------------------------------------------
 * THE COSTS, because "just use transactions" is not senior advice
 * -----------------------------------------------------------------------------
 *   - They hold locks and consume server resources; long transactions block
 *     others and can hit the 60-second default `transactionLifetimeLimitSeconds`.
 *   - Every operation inside MUST be passed the session. An operation that
 *     forgets `{ session }` runs OUTSIDE the transaction and will not roll
 *     back - a silent, extremely common bug.
 *   - The callback may run MORE THAN ONCE on retry, so it must be idempotent:
 *     no `counter++` on a captured variable, no sending an email inside.
 *   - They do not work across services. The moment `tasks` and `comments` live
 *     in different databases (Phase 20), you need the saga pattern and
 *     compensating actions instead.
 *
 * PREFER A BETTER DATA MODEL FIRST. If two pieces of data must always change
 * together, embedding them in one document makes the write atomic for free.
 * Transactions are for when the aggregates are genuinely separate.
 * =============================================================================
 */
@Injectable()
export class TransactionRunner {
  private readonly logger = new Logger(TransactionRunner.name);

  /**
   * `@InjectConnection()` injects the Mongoose `Connection` created by
   * `MongooseModule.forRootAsync`. It is the connection-level counterpart of
   * `@InjectModel()`, and it is how you reach anything the Model API does not
   * expose: sessions, transactions, `db.admin()`, raw collection access.
   */
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Run `work` inside a transaction, committing on success and aborting on any
   * throw.
   *
   * The callback receives the `ClientSession`, and EVERY query inside must pass
   * it (`.session(session)` or `{ session }`). That requirement is the main
   * source of bugs, which is why the repository methods in this project take an
   * optional `session` parameter rather than hiding it.
   */
  async run<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();

    try {
      // `withTransaction` retries transient errors for us and commits on
      // return. Doing this by hand (startTransaction/commit/abort) is where
      // people forget the retry semantics.
      return await session.withTransaction(async () => work(session));
    } catch (error) {
      this.logger.error(
        `Transaction aborted: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      // ALWAYS. A leaked session holds server-side state until it times out,
      // and enough of them exhaust the session pool.
      await session.endSession();
    }
  }
}
