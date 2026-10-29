import { Provider } from '@nestjs/common';

import { APP_METADATA } from '../constants/injection-tokens';

/**
 * The shape of the value behind the APP_METADATA token.
 *
 * Note it is an INTERFACE, not a class - which is precisely why the token in
 * `injection-tokens.ts` has to exist. `constructor(private m: AppMetadata) {}`
 * cannot work: interfaces are erased, so there is nothing to look up.
 */
export interface AppMetadata {
  readonly name: string;
  readonly version: string;
  /** Set by CI at build time; `local` when built on a developer machine. */
  readonly commit: string;
  readonly builtAt: string;
  readonly nodeVersion: string;
}

/**
 * =============================================================================
 * CUSTOM PROVIDER #1: `useValue`
 * =============================================================================
 * 1. WHAT IT IS
 * The simplest recipe there is: "here is the finished object, hand it out".
 * Nest constructs nothing and injects nothing - it just stores the value under
 * the token.
 *
 *     { provide: APP_METADATA, useValue: { name: 'taskflow-api', ... } }
 *
 * 2. WHEN IT IS THE RIGHT CHOICE
 *   - CONSTANTS AND CONFIGURATION objects with no construction logic.
 *   - THIRD-PARTY OBJECTS you already have an instance of (a pre-built SDK
 *     client, a Stripe instance created in bootstrap).
 *   - MOCKS AND STUBS IN TESTS - by far the most common use. Every
 *     `{ provide: X, useValue: fake }` in this repo's spec files is a `useValue`
 *     provider. Same token, different recipe: that is the whole substitution
 *     mechanism, and it is why "DI makes code testable" is a mechanical fact
 *     rather than a slogan.
 *
 * 3. WHEN NOT TO USE IT
 *   - When building the value needs other providers -> `useFactory`.
 *   - When building it is async -> `useFactory` (an async one).
 *   - When you want Nest to construct a class for you -> `useClass`.
 *
 * 4. THE TRAP: `useValue` IS EVALUATED WHEN THE MODULE FILE IS EVALUATED.
 * The object below is built at `import` time, before the DI container exists
 * and before `ConfigModule` has validated anything. So a `useValue` provider
 * may NOT depend on configuration, and reading `process.env` inside one is a
 * race you will eventually lose. If you need config, you need a factory.
 *
 * 5. THE OTHER TRAP: `useValue` HANDS OUT A SHARED, MUTABLE REFERENCE.
 * Every consumer receives the same object. One of them doing
 * `metadata.version = 'x'` mutates it for the entire application, for the rest
 * of the process's life - a global variable with extra steps. Hence
 * `Object.freeze` below, and `readonly` on the interface. `readonly` is a
 * compile-time promise; `freeze` is the runtime one. Use both.
 * =============================================================================
 */
export const appMetadata: AppMetadata = Object.freeze({
  name: 'taskflow-api',
  // Populated by the build; falls back for local runs.
  version: process.env.npm_package_version ?? '0.1.0',
  // In CI this is the git SHA (e.g. `GIT_COMMIT` injected by the pipeline).
  commit: process.env.GIT_COMMIT ?? 'local',
  builtAt: process.env.BUILD_TIME ?? new Date().toISOString(),
  nodeVersion: process.version,
});

/**
 * Exporting the PROVIDER OBJECT rather than just the value.
 *
 * WHY: the module file then reads `providers: [appMetadataProvider]` instead of
 * repeating the `{ provide, useValue }` literal. The token and its recipe stay
 * together in one file, so there is exactly one place to look when you ask
 * "what is behind APP_METADATA?".
 *
 * The `Provider` type annotation is doing real work: it type-checks the shape
 * of the provider object at compile time, so a typo in `provide`/`useValue`
 * fails the build rather than the boot.
 */
export const appMetadataProvider: Provider = {
  provide: APP_METADATA,
  useValue: appMetadata,
};
