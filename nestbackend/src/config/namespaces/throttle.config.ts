import { registerAs } from '@nestjs/config';

import type { ThrottleConfig } from '../config.types';
import { envNumber } from '../env.util';

/** Global rate-limit window. Deep dive (incl. Redis storage) in Phase 10. */
export const throttleConfig = registerAs<ThrottleConfig>('throttle', () => ({
  ttl: envNumber('THROTTLE_TTL'),
  limit: envNumber('THROTTLE_LIMIT'),
}));
