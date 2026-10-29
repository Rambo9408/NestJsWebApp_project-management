import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Stops the shared mongod. Without this the Jest process hangs after the last
 * test - an open handle keeps the event loop alive, which is the same class of
 * problem as forgetting to `quit()` a Redis client (Phase 3).
 */
export default async function globalTeardown(): Promise<void> {
  const replSet = (globalThis as { __MONGO_REPLSET__?: MongoMemoryReplSet }).__MONGO_REPLSET__;
  await replSet?.stop();
}
