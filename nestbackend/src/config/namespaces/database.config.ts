import { registerAs } from '@nestjs/config';

import type { DatabaseConfig } from '../config.types';
import { envNumber, requireEnv } from '../env.util';

/**
 * MongoDB connection settings. See app.config.ts for what registerAs does.
 *
 * Pool sizing note (expanded in README > Performance): Mongoose maintains a
 * pool of TCP sockets per Node process. Requests that arrive when every socket
 * is busy WAIT - they do not open a new connection. So an undersized pool
 * shows up as latency, not errors, which makes it a nasty thing to diagnose.
 * An oversized pool moves the problem to the database server, which has its
 * own connection ceiling (and each connection costs it roughly 1MB of RAM).
 *
 * Rule of thumb: maxPoolSize x number of app instances must stay comfortably
 * below the MongoDB server connection limit.
 */
export const databaseConfig = registerAs<DatabaseConfig>('database', () => ({
  uri: requireEnv('MONGODB_URI'),
  maxPoolSize: envNumber('MONGODB_MAX_POOL_SIZE'),
  minPoolSize: envNumber('MONGODB_MIN_POOL_SIZE'),
}));
