/**
 * =============================================================================
 * ENVIRONMENT CONFIGURATION
 * =============================================================================
 * ONE module reads `import.meta.env`. Everything else imports from here.
 *
 * WHY CENTRALISE: an env var referenced in fifteen files is fifteen chances to
 * typo it, and a typo produces `undefined` at runtime rather than a build
 * error. Reading each one once, here, means a missing variable fails loudly and
 * immediately - and it gives you a single list of everything the app needs to
 * run, which is exactly what a deployment checklist should be.
 *
 * ANGULAR BRIDGE: this replaces `environment.ts` / `environment.prod.ts`. The
 * mechanism is different in an important way. Angular SWAPS FILES at build
 * time; Vite does STRING SUBSTITUTION at build time. In both cases the value is
 * baked into the bundle - which leads directly to the security note below.
 * =============================================================================
 */

/**
 * =============================================================================
 * SECURITY: THERE ARE NO SECRETS IN A FRONTEND BUILD
 * =============================================================================
 * Vite only exposes variables prefixed `VITE_`, and that prefix is a SAFETY
 * RAIL, not a security boundary. Anything exposed is substituted as a literal
 * into the JavaScript bundle that you then ship to every browser. `curl` on
 * your own bundle reads it back.
 *
 * So: API urls and feature flags belong here. An API key, a database password
 * or a JWT signing secret NEVER does. If a value must stay secret, the only
 * place it can live is the NestJS backend, and the browser must ask the backend
 * to use it on its behalf.
 *
 * INTERVIEW: "how do you store the API secret in a React app?" is a trap
 * question. The correct answer is "you cannot, and I would move the call that
 * needs it to the server."
 * =============================================================================
 */

/**
 * The API base path.
 *
 * DEFAULTS TO A RELATIVE PATH, and that is deliberate.
 *
 * In dev, Vite's proxy (vite.config.ts) forwards /api to localhost:3000.
 * In prod, nginx serves the bundle and reverse-proxies /api to NestJS.
 * Both are same-origin, so the SAME relative string is correct in both - no
 * environment branching, no CORS, and cookies attach without ceremony.
 *
 * The override exists for the one case that genuinely needs it: pointing a
 * local frontend at a deployed staging API.
 *
 * `/api/v1` because the backend sets a global prefix of `api` AND enables URI
 * versioning with `defaultVersion: '1'` (main.ts). Both segments are required -
 * calling `/api/tasks` returns 404.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/**
 * Health probes are deliberately EXCLUDED from the global prefix on the backend
 * (`exclude: ['health/live', ...]` in main.ts) so infrastructure can probe a
 * stable path that no API version change can break. That means it does NOT
 * live under /api/v1, and hardcoding it there is a mistake worth naming.
 */
export const HEALTH_URL = '/health/live';

/** Vite's own flags. Preferred over NODE_ENV, which Vite does not define. */
export const IS_DEV: boolean = import.meta.env.DEV;
export const IS_PROD: boolean = import.meta.env.PROD;
