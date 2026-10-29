import { z } from 'zod';

/**
 * =============================================================================
 * ZOD SCHEMAS - mirroring the NestJS DTOs, rule for rule
 * =============================================================================
 * Every constraint below is TRANSCRIBED FROM THE BACKEND, with its source
 * cited. They are not invented, and they are not "roughly similar".
 *
 * -----------------------------------------------------------------------------
 * WHY FRONTEND VALIDATION DOES NOT REPLACE BACKEND VALIDATION
 * -----------------------------------------------------------------------------
 * This is a guaranteed interview question and the answer is not subtle:
 *
 *   THE FRONTEND IS NOT A SECURITY BOUNDARY. Anyone can open DevTools, or
 *   `curl` the endpoint directly, or use an old cached bundle. Client validation
 *   is a UX feature - instant feedback without a round-trip - and nothing more.
 *
 *   THE BACKEND VALIDATION IS THE REAL ONE. It runs on every request from every
 *   client, and it is what actually protects the database.
 *
 * So there are two implementations of the same rules, in two languages. That
 * duplication is a real cost and it WILL drift - someone relaxes the password
 * rule server-side and this file keeps rejecting valid passwords, or tightens
 * it and users hit a 400 the form said was fine.
 *
 * THE HONEST MITIGATIONS, in order of preference:
 *   1. GENERATE from the OpenAPI document. The backend publishes a schema; the
 *      client derives from it. Drift becomes impossible rather than unlikely.
 *   2. SHARE a schema package if both sides are TypeScript. Not possible here -
 *      the backend uses class-validator decorators, which cannot be imported
 *      into a browser bundle.
 *   3. CITE THE SOURCE in comments, as below, and always render the server's
 *      own error messages when it rejects something (see `applyServerErrors`).
 *      That way the server stays authoritative even when this file is wrong.
 *
 * We do (3) now and (1) in Phase 7. Being able to explain that ladder is worth
 * more in an interview than claiming the duplication is fine.
 * =============================================================================
 */

/**
 * EMAIL - backend: `@TrimLower()` + `@IsEmail()` on CreateUserDto.email
 *
 * `.trim().toLowerCase()` are TRANSFORMS, not just checks. Zod runs them as
 * part of parsing, so the value handed to the API is already normalised -
 * exactly what the backend's own decorators do to it on arrival.
 *
 * WHY THAT MATTERS: without it, "  Ada@Example.com " and "ada@example.com"
 * would look like different accounts to any client-side comparison, and the
 * user who typed a trailing space would get "invalid credentials" on a
 * perfectly correct password.
 *
 * NOTE THE ORDER: trim BEFORE validating. `z.email().trim()` would reject
 * " a@b.com " before ever trimming it.
 */
const email = z
  .string()
  .trim()
  .toLowerCase()
  // The backend overrides the default message with this exact string. Matching
  // it means the user sees the same words whether the check ran locally or on
  // the server - a small consistency that makes the app feel less improvised.
  .pipe(z.email('email must be a valid email address'));

/**
 * NAME - backend: `@Trim()` + `@IsString()` + `@Length(2, 80)`
 *
 * The 80 is not decoration. Omit it here and a 90-character name passes the
 * form, fails server-side, and the user is told about a limit the UI never
 * mentioned.
 */
const name = z
  .string()
  .trim()
  .min(2, 'name must be longer than or equal to 2 characters')
  .max(80, 'name must be shorter than or equal to 80 characters');

/**
 * PASSWORD - backend: `@IsStrongPassword()`
 * (src/common/validators/is-strong-password.validator.ts)
 *
 * The server's rule, read from the source:
 *     length >= 10  AND  /[a-z]/  AND  /[A-Z]/  AND  /\d/
 *
 * SEPARATE `.regex()` CALLS RATHER THAN ONE LOOKAHEAD MONSTER.
 *
 *   BAD:  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/
 *
 * That is one rule with one message, so a user who forgot a digit is told the
 * whole policy again and has to work out which part they failed. Four separate
 * checks produce four specific messages, and Zod reports all of them - so the
 * user sees exactly what is missing.
 *
 * THE UX PRINCIPLE: a validation message should say how to FIX the input, not
 * restate the policy. The backend author made the same call - their
 * `defaultMessage` comment says "Invalid password is the most common and least
 * useful validation message there is."
 */
const password = z
  .string()
  .min(10, 'password must be at least 10 characters')
  .regex(/[a-z]/, 'password must contain a lower case letter')
  .regex(/[A-Z]/, 'password must contain an upper case letter')
  .regex(/\d/, 'password must contain a digit');

/**
 * LOGIN - backend: LoginDto is only `@IsString()` on both fields.
 *
 * DELIBERATELY WEAKER THAN REGISTER, and this is a real design decision rather
 * than an oversight.
 *
 * Applying the full password policy here would lock out any user whose password
 * predates the current rules - they would be told their own correct password is
 * invalid, by a form, with no way forward. The same applies if the policy is
 * ever tightened.
 *
 * A login form validates PRESENCE, not policy. The server decides whether the
 * credentials are right, and it deliberately returns one indistinguishable
 * error for "no such user" and "wrong password" so the form cannot be used to
 * enumerate accounts.
 *
 * INTERVIEW: "why not reuse the register schema for login?" - it is a small
 * question that shows whether you think about existing users.
 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * REGISTER - backend: `RegisterDto extends OmitType(CreateUserDto, ['role'])`
 *
 * NOTE THE OMITTED `role`. The backend removes it from the public registration
 * DTO on purpose: if it were accepted, anyone could POST
 * `{"role": "admin"}` and grant themselves administrator. New users always get
 * the schema default, MEMBER.
 *
 * That is MASS ASSIGNMENT, and it is one of the most common real-world API
 * vulnerabilities. Our schema must not send `role` either - and because the
 * backend's global ValidationPipe uses `whitelist: true`, an unexpected
 * property would be stripped anyway. Defence at both ends.
 */
export const registerSchema = z.object({
  name,
  email,
  password,
  /**
   * CONFIRM PASSWORD IS A CLIENT-ONLY FIELD. The backend has no such property -
   * it is a UX guard against typing a password you cannot reproduce, and it is
   * validated by the `.refine()` below, never sent to the API.
   *
   * A good reminder that the form model and the API model are related but not
   * identical. Conflating them is how `confirmPassword` ends up in a request
   * body.
   */
  confirmPassword: z.string(),
});

/**
 * CROSS-FIELD VALIDATION with `.refine()`.
 *
 * A per-field schema cannot express "these two must match" because it only ever
 * sees one value. `.refine()` runs against the whole object after the field
 * rules pass.
 *
 * `path: ['confirmPassword']` IS THE IMPORTANT PART. Without it the error is
 * attached to the form ROOT, and React Hook Form has no field to display it
 * against - so the message renders nowhere and the form silently refuses to
 * submit. That symptom ("my form won't submit and shows no error") is almost
 * always a missing `path`.
 */
export const registerFormSchema = registerSchema.refine(
  (values) => values.password === values.confirmPassword,
  { message: 'Passwords do not match', path: ['confirmPassword'] },
);

/**
 * TYPES DERIVED FROM THE SCHEMAS, never written by hand.
 *
 * `z.infer` extracts the OUTPUT type. Change a schema and the type changes with
 * it, so the form and the schema cannot disagree. Declaring
 * `interface RegisterFormValues { ... }` separately would give you two things
 * to keep in sync - which is the exact problem this file already has with the
 * backend, and there is no reason to create a second instance of it locally.
 *
 * INTERVIEW: "how do you type a form?" - infer from the validation schema. One
 * source of truth.
 */
export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerFormSchema>;

/**
 * The payload actually sent to POST /auth/register.
 *
 * `Omit<..., 'confirmPassword'>` makes it a TYPE ERROR to send the client-only
 * field, rather than a code-review comment. The compiler enforces the boundary.
 */
export type RegisterPayload = Omit<RegisterFormValues, 'confirmPassword'>;

export function toRegisterPayload(values: RegisterFormValues): RegisterPayload {
  const { confirmPassword: _confirmPassword, ...payload } = values;
  return payload;
}
