/// <reference types="vite/client" />

/**
 * =============================================================================
 * TYPED ENVIRONMENT VARIABLES
 * =============================================================================
 * By default `import.meta.env.VITE_ANYTHING` is typed `any`. That is worse than
 * it sounds: `any` spreads. Assigning it to a variable makes that variable
 * `any` too, and every check the compiler would have done downstream silently
 * stops happening. Our lint config catches it as `no-unsafe-assignment`, which
 * is exactly the rule earning its keep.
 *
 * Declaring the interface here restores real types AND turns the set of
 * supported variables into something the compiler knows about - a typo in
 * `VITE_API_BSE_URL` becomes an error rather than `undefined` at runtime.
 *
 * NOTE `?:` on the variable. It is genuinely optional - the app falls back to
 * a relative path - so the type must say so. Typing it as a required `string`
 * would be a lie that hides the need for the `??` fallback in config/env.ts.
 * =============================================================================
 */
interface ImportMetaEnv {
  /** Override the API base path. Unset in normal local dev - see .env.example. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
