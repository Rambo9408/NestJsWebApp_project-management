import { registerAs } from '@nestjs/config';

import type { CacheConfig } from '../config.types';
import { envNumber } from '../env.util';

/** Default TTL (seconds) for cache-aside entries. Deep dive in Phase 10. */
export const cacheConfig = registerAs<CacheConfig>('cache', () => ({
  defaultTtl: envNumber('CACHE_DEFAULT_TTL'),
}));
