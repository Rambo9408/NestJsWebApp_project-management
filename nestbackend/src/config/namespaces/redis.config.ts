import { registerAs } from '@nestjs/config';

import type { RedisConfig } from '../config.types';
import { envNumber, optionalEnv, requireEnv } from '../env.util';

/**
 * Redis connection settings, shared by three subsystems (cache, BullMQ queues,
 * and pub/sub fan-out for SSE).
 *
 * keyPrefix matters more than it looks: it is what lets two environments share
 * one Redis server safely, and what makes it possible to invalidate a whole
 * feature area (taskflow:dev:projects:*) without a FLUSHALL that would also
 * delete your queues.
 */
export const redisConfig = registerAs<RedisConfig>('redis', () => ({
  host: requireEnv('REDIS_HOST'),
  port: envNumber('REDIS_PORT'),
  password: optionalEnv('REDIS_PASSWORD'),
  db: envNumber('REDIS_DB'),
  keyPrefix: requireEnv('REDIS_KEY_PREFIX'),
}));
