/**
 * Build a connection URI against the ONE mongod that `test/global-setup.ts`
 * started for the whole run.
 *
 * Each suite passes its own database name, so suites are isolated by DATABASE
 * while sharing a daemon - isolation where it matters, sharing where it does
 * not.
 */
export function sharedUri(databaseName: string): string {
  const base = process.env.MONGO_TEST_URI;

  if (!base) {
    throw new Error(
      'MONGO_TEST_URI is not set. Is jest globalSetup (test/global-setup.ts) configured?',
    );
  }

  // `getUri()` returns `mongodb://host:port/` - append the database name before
  // any query string.
  const [origin, query] = base.split('?');
  const withDb = `${origin.replace(/\/$/, '')}/${databaseName}`;

  return query ? `${withDb}?${query}` : withDb;
}
