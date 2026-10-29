import type { RegisterRequest, CreateTaskRequest } from './requests';
import type { RegisterPayload } from '@/features/auth/authSchemas';
import type { TaskPriority } from './api';

/**
 * =============================================================================
 * COMPILE-TIME DRIFT DETECTION
 * =============================================================================
 * This file contains no runtime code. It exists so that `tsc` fails when the
 * hand-written half of the contract stops agreeing with the GENERATED half.
 *
 * WHY A FILE OF TYPE ASSERTIONS RATHER THAN A TEST: a test runs the code that
 * exists. This checks the SHAPE of types, which have no runtime existence at
 * all - there is nothing for a test to execute. `tsc --noEmit` is the only tool
 * that can see this class of bug, and it already runs in CI.
 *
 * THE PATTERN - `Expect<Equal<A, B>>` - is the standard TypeScript type-level
 * assertion. It is worth being able to write from memory; it comes up in
 * senior TypeScript interviews and in any library with non-trivial types.
 * =============================================================================
 */

/**
 * `Equal` is the canonical deep type-equality check.
 *
 * HOW IT WORKS, because it looks like nonsense on first read: two conditional
 * types are compared, each deferred on a naked type parameter. TypeScript only
 * treats two deferred conditionals as identical when their check types are
 * mutually assignable AND identical in variance - which makes this stricter
 * than `A extends B ? true : false`, and crucially able to distinguish `any`
 * from a real type.
 *
 * A plain `extends` check would pass for a SUBSET, which is exactly the drift
 * we want to catch: a type missing a field the server now requires still
 * "extends" nothing wrong.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Compiles only when the argument is `true`. This is the assertion itself. */
type Expect<T extends true> = T;

/* ===========================================================================
 * ASSERTION 1: our register payload matches the backend's RegisterDto exactly
 * ======================================================================== */

/**
 * `RegisterPayload` is derived from the ZOD SCHEMA (`Omit<RegisterFormValues,
 * 'confirmPassword'>`). `RegisterRequest` is GENERATED from the backend.
 *
 * If they ever disagree - a field added, removed, renamed, or made optional -
 * this line stops compiling and `npm run typecheck` fails.
 *
 * THIS IS THE SINGLE MOST VALUABLE LINE IN THE FILE. It means the Phase 6
 * duplication between Zod and class-validator can no longer drift SILENTLY on
 * field shape. (It still cannot police the RULES - Zod's `min(10)` versus the
 * backend's length check - because OpenAPI does not carry them. Structure is
 * enforced; semantics stay a test's job, which is what authSchemas.test.ts is
 * for.)
 */
export type _RegisterPayloadMatchesBackend = Expect<Equal<RegisterPayload, RegisterRequest>>;

/* ===========================================================================
 * ASSERTION 2: our TaskPriority union matches the backend's enum
 * ======================================================================== */

/**
 * `TaskPriority` is hand-written in api.ts, transcribed from
 * `src/tasks/schemas/task.schema.ts`. The generated `CreateTaskRequest`
 * carries the same values, extracted from `@IsEnum(TaskPriority)`.
 *
 * `NonNullable<...>` strips the `undefined` that `priority?:` adds, so we are
 * comparing the value unions rather than optionality.
 *
 * Add `TaskPriority.CRITICAL` on the backend and this fails - which is exactly
 * when you want to know, rather than when a badge renders blank in production.
 */
export type _TaskPriorityMatchesBackend = Expect<
  Equal<NonNullable<CreateTaskRequest['priority']>, TaskPriority>
>;

/* ===========================================================================
 * WHAT THIS FILE CANNOT CHECK - stated so nobody assumes more than it does
 * ======================================================================== */

/**
 * 1. RESPONSE SHAPES. The OpenAPI document has no response schemas (see
 *    requests.ts), so `User`, `Task` and `Paginated<T>` in api.ts are still
 *    hand-written assertions verified against the live wire, not guarantees.
 *
 * 2. VALIDATION RULES. OpenAPI carries `format: email` but not "at least 10
 *    characters with an upper case letter". Those live in authSchemas.test.ts.
 *
 * 3. STALENESS. The generated file is a SNAPSHOT, checked in. It only reflects
 *    the backend as of the last `npm run api:types`. The real fix is a CI step
 *    that regenerates against the deployed API and fails on a non-empty diff -
 *    then drift breaks the build the day it is introduced rather than the day
 *    somebody happens to regenerate. That is the standard setup and it is worth
 *    proposing by name in an interview.
 */
