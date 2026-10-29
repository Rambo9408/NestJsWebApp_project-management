/**
 * Tiny helpers used ONLY inside `registerAs` factories.
 *
 * By the time these run, Joi (env.validation.ts) has already validated and
 * applied defaults, and @nestjs/config has written the validated values back
 * onto `process.env`. So in practice these never throw.
 *
 * WHY have them then? Because "in practice never throws" is exactly the kind
 * of assumption that rots. The day someone adds `SMTP_HOST` to a namespace and
 * forgets to add it to the Joi schema, `requireEnv` fails loudly at boot with
 * the variable name, instead of silently producing `undefined` that surfaces
 * three layers away as "cannot read property of undefined".
 *
 * This is the "assert your invariants at the boundary" habit - the same reason
 * we validate DTOs at the controller edge (Phase 6) rather than trusting
 * callers deeper in the stack.
 */

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing environment variable "${key}". Add it to your .env file AND to envValidationSchema in src/config/env.validation.ts.`,
    );
  }
  return value;
}

/** Same as requireEnv but tolerates an empty string (e.g. an optional password). */
export function optionalEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
}

export function envNumber(key: string): number {
  const raw = requireEnv(key);
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable "${key}" must be a number, received "${raw}".`);
  }
  return parsed;
}

export function envBoolean(key: string): boolean {
  // Joi coerces "true"/"1"/"yes" during validation, but process.env can only
  // ever hold strings - so we normalise once, here.
  return ['true', '1', 'yes', 'on'].includes(requireEnv(key).toLowerCase());
}

/** Turns a comma-separated list into a real array, dropping empty entries. */
export function envList(key: string): string[] {
  return requireEnv(key)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
