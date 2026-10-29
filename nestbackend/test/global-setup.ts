import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * =============================================================================
 * Jest globalSetup - ONE mongod for the whole run
 * =============================================================================
 * Each integration suite used to start its own `MongoMemoryReplSet`. That is
 * correct but slow: starting a real mongod costs several seconds, and three
 * suites meant three of them, serially, on every run. The suite crossed ten
 * minutes, which is the point at which people stop running it locally - and a
 * test suite nobody runs is worse than one that is slightly less isolated.
 *
 * ONE server, MANY DATABASES. Each suite still gets its own database name, so
 * they cannot see each other's data; they just share a process. That is the
 * right trade: isolation where it matters (data), sharing where it does not
 * (the daemon).
 *
 * WHY A REPLICA SET even here: transactions do not exist on a standalone
 * mongod, so `TasksService.remove` would fail. Same reason `docker-compose.yml`
 * runs one.
 *
 * The instance is stashed on `globalThis` because `globalSetup` and
 * `globalTeardown` run in separate module registries - a module-level variable
 * would be `undefined` by teardown time.
 */
export default async function globalSetup(): Promise<void> {
  // Escape hatch for machines where the downloaded `mongod` binary cannot be
  // spawned (Windows AV / `spawn UNKNOWN`). Point it at the docker-compose
  // replica set, e.g.
  //   MONGO_TEST_URI="mongodb://127.0.0.1:27018/?directConnection=true"
  // Suites still use their own database names, so dev data is untouched.
  if (process.env.MONGO_TEST_URI) {
    // The in-memory server was thrown away after every run; an external one is
    // not, so stale users from the last run would turn every `register` into a
    // 409. Drop ONLY the suites' own databases (`taskflow_test` and `taskflow_*_test`) - never the
    // dev database.
    const client = new MongoClient(process.env.MONGO_TEST_URI);
    try {
      const { databases } = await client.db().admin().listDatabases();
      await Promise.all(
        databases
          .map((d) => d.name)
          .filter((name) => /^taskflow(_.+)?_test$/.test(name))
          .map((name) => client.db(name).dropDatabase()),
      );
    } finally {
      await client.close();
    }
    return;
  }

  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  (globalThis as { __MONGO_REPLSET__?: MongoMemoryReplSet }).__MONGO_REPLSET__ = replSet;

  // Suites read this and append their own database name.
  process.env.MONGO_TEST_URI = replSet.getUri();
}
