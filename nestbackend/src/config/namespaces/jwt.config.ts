import { registerAs } from '@nestjs/config';

import type { JwtConfig, JwtDuration } from '../config.types';
import { requireEnv } from '../env.util';

/**
 * Token settings for the auth module (Phase 7).
 *
 * Short access TTL + long refresh TTL is the standard compromise:
 *   - Access tokens are sent on every request and are stateless, so they
 *     cannot be revoked; they must expire fast. 15 minutes caps the damage of
 *     a leaked token.
 *   - Refresh tokens are sent rarely and are stored server-side (hashed), so
 *     they CAN be revoked - which is why they may live for days.
 * Phase 7 covers rotation and reuse detection.
 */
export const jwtConfig = registerAs<JwtConfig>('jwt', () => ({
  accessSecret: requireEnv('JWT_ACCESS_SECRET'),
  // Validated as a string by Joi; narrowed here to the duration shape the
  // JWT library expects. One cast, at the boundary, instead of many downstream.
  accessTtl: requireEnv('JWT_ACCESS_TTL') as JwtDuration,
  refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
  refreshTtl: requireEnv('JWT_REFRESH_TTL') as JwtDuration,
}));
