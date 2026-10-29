import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

/**
 * =============================================================================
 * A CUSTOM VALIDATION DECORATOR
 * =============================================================================
 * class-validator ships `@IsStrongPassword()`, and this reimplements it - on
 * purpose. The pattern (constraint class + factory decorator) is what you need
 * for any rule the library does not have: "must be a valid project key", "must
 * be a future date in the user's timezone", "must not be a reserved word".
 *
 * TWO PIECES:
 *   1. A `@ValidatorConstraint()` class with `validate()` and
 *      `defaultMessage()`.
 *   2. A factory function that calls `registerDecorator` so the rule reads like
 *      every built-in one: `@IsStrongPassword()`.
 *
 * `async: false` matters. A SYNCHRONOUS constraint can be evaluated without
 * awaiting, which keeps validation cheap. Constraints CAN be async (returning a
 * Promise), and that is how people implement `@IsUniqueEmail()` with a database
 * lookup - see the warning below before you do that.
 * =============================================================================
 */
@ValidatorConstraint({ name: 'isStrongPassword', async: false })
export class IsStrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;

    /**
     * NIST SP 800-63B's actual guidance, which is worth knowing because it
     * contradicts what most applications still do: LENGTH is what matters.
     * Composition rules (one upper, one digit, one symbol) push users toward
     * `Password1!` and toward reuse, and they are explicitly discouraged.
     *
     * We keep a light composition rule here anyway, because it is what an
     * interviewer will expect to see and because this is a demo - but the
     * comment is the honest part: the highest-value controls are a long
     * minimum, a check against known-breached password lists (Have I Been
     * Pwned's k-anonymity API), and rate limiting on login (Phase 10).
     */
    if (value.length < 10) return false;

    const hasLower = /[a-z]/.test(value);
    const hasUpper = /[A-Z]/.test(value);
    const hasDigit = /\d/.test(value);

    return hasLower && hasUpper && hasDigit;
  }

  defaultMessage(args: ValidationArguments): string {
    // A message that tells the user how to FIX it. "Invalid password" is the
    // most common and least useful validation message there is.
    return `${args.property} must be at least 10 characters and contain lower case, upper case and a digit`;
  }
}

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStrongPasswordConstraint,
    });
  };
}

/**
 * =============================================================================
 * A WARNING ABOUT DATABASE-BACKED VALIDATORS (`@IsUniqueEmail()`)
 * =============================================================================
 * class-validator supports async constraints, and Nest lets them inject
 * providers if you call `useContainer(app, { fallbackOnErrors: true })` in
 * `main.ts`. So you CAN write:
 *
 *     @IsUniqueEmail()  email: string;      // queries the database
 *
 * It is popular, it demos well, and it has three real problems:
 *
 *   1. IT DOES NOT GUARANTEE ANYTHING. Check-then-act: two concurrent
 *      registrations both pass validation, and only the unique index actually
 *      prevents the duplicate. So you still need the index and the 11000
 *      translation - the validator is a nicer message, not a constraint.
 *
 *   2. IT PUTS I/O IN THE VALIDATION LAYER. Every request now hits the database
 *      before reaching a guard-approved handler, which makes an unauthenticated
 *      endpoint a free database-load generator.
 *
 *   3. IT COUPLES DTOs TO REPOSITORIES. Your wire contract can no longer be
 *      shared with a frontend or generated from OpenAPI without dragging in
 *      persistence.
 *
 * THE POSITION THIS PROJECT TAKES: validators check SHAPE; services check
 * BUSINESS RULES; the database ENFORCES invariants. `UsersService.create` does
 * the friendly duplicate check and the unique index makes it true. Being able
 * to argue this distinction is a strong senior signal - the naive answer is
 * "use a custom async validator", and the better answer explains why that is
 * not where correctness lives.
 * =============================================================================
 */
