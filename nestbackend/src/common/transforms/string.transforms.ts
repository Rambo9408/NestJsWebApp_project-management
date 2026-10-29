import { Transform } from 'class-transformer';

/**
 * =============================================================================
 * Reusable transform decorators
 * =============================================================================
 * These wrap `@Transform` so DTOs read as intent (`@Trim()`) rather than as
 * mechanics (`@Transform(({ value }) => typeof value === 'string' ? ... )`),
 * and so the type-guard is written once instead of eight times.
 *
 * WHY THE `typeof value === 'string'` GUARD MATTERS: a transform runs BEFORE
 * validation, on whatever the client sent. If someone posts
 * `{"name": {"$ne": null}}`, an unguarded `value.trim()` throws a TypeError
 * deep inside class-transformer and surfaces as a 500 - so a malformed request
 * becomes a server error, and an attacker has a cheap way to fill your error
 * logs. Guarding passes the non-string through untouched, and the validator
 * then rejects it properly with a 400.
 *
 * That ordering - transform first, validate second - is worth remembering
 * generally: transforms must be TOTAL functions that never throw, because they
 * see unvalidated input by definition.
 *
 * TYPING NOTE: `({ value }: { value: unknown })` is not noise. Without it,
 * class-transformer's callback parameter is `any`, and every one of these
 * decorators trips `no-unsafe-return` - which is exactly the rule you want on
 * while handling untrusted input.
 * =============================================================================
 */

/** Trim surrounding whitespace. Leaves non-strings alone for the validator. */
export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

/** Trim and lowercase - for emails, where the unique index depends on it. */
export function TrimLower(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
}

/** Trim and uppercase - for project keys, where the unique index depends on it. */
export function TrimUpper(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );
}

/**
 * HTTP has no booleans: `?overdue=true` arrives as the STRING `"true"`.
 *
 * `@Type(() => Boolean)` is NOT sufficient - `Boolean("false")` is `true`,
 * because every non-empty string is truthy. This trap catches people
 * constantly, which is why the conversion is explicit and named.
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => value === true || value === 'true');
}
