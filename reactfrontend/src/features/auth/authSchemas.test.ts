import { describe, expect, it } from 'vitest';
import { loginSchema, registerFormSchema, toRegisterPayload } from './authSchemas';

/**
 * =============================================================================
 * TESTING THE SCHEMAS AGAINST THE BACKEND'S ACTUAL RULES
 * =============================================================================
 * These are the highest-value tests in the phase, because they are the only
 * thing standing between us and SILENT DRIFT from the server's validation.
 *
 * Each case is derived from a rule read out of the NestJS source:
 *   is-strong-password.validator.ts  length >= 10, lower, upper, digit
 *   create-user.dto.ts               @Length(2, 80) on name, @IsEmail on email
 *
 * If someone relaxes the client rule, one of these fails. It does not stop the
 * BACKEND changing underneath us - only generated types can do that (Phase 7) -
 * but it stops the client drifting on its own.
 * =============================================================================
 */

const valid = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'Str0ngPassword',
  confirmPassword: 'Str0ngPassword',
};

describe('registerFormSchema', () => {
  it('accepts a valid registration', () => {
    expect(registerFormSchema.safeParse(valid).success).toBe(true);
  });

  describe('password - mirrors @IsStrongPassword()', () => {
    /**
     * ONE CASE PER RULE, each failing exactly one.
     *
     * A single "bad password" test would pass even if three of the four checks
     * were deleted - it only proves *something* rejected it. Testing each rule
     * in isolation is what makes the suite a specification rather than a smoke
     * test.
     */
    it.each([
      ['too short (9 chars)', 'Sh0rtPas', /at least 10 characters/],
      ['no digit', 'NoDigitsHere', /must contain a digit/],
      ['no upper case', 'str0ngpassword', /upper case/],
      ['no lower case', 'STR0NGPASSWORD', /lower case/],
    ])('rejects %s', (_label, password, expected) => {
      const result = registerFormSchema.safeParse({
        ...valid,
        password,
        confirmPassword: password,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message).join(' ')).toMatch(expected);
      }
    });

    it('accepts exactly 10 characters', () => {
      // BOUNDARY TEST. `> 10` instead of `>= 10` is the classic off-by-one, and
      // it only shows up at exactly the boundary.
      const password = 'Passw0rdAb';
      expect(password).toHaveLength(10);
      expect(
        registerFormSchema.safeParse({ ...valid, password, confirmPassword: password }).success,
      ).toBe(true);
    });
  });

  describe('name - mirrors @Length(2, 80)', () => {
    it('rejects a single character', () => {
      expect(registerFormSchema.safeParse({ ...valid, name: 'A' }).success).toBe(false);
    });

    it('rejects more than 80 characters', () => {
      expect(registerFormSchema.safeParse({ ...valid, name: 'A'.repeat(81) }).success).toBe(false);
    });

    it('trims before measuring, so whitespace cannot pad a short name', () => {
      // `' A '` is 3 characters raw and 1 after trimming. The backend's @Trim()
      // runs before @Length, so it rejects this - and so must we, or the form
      // accepts a name the server refuses.
      expect(registerFormSchema.safeParse({ ...valid, name: ' A ' }).success).toBe(false);
    });
  });

  describe('email - mirrors @TrimLower() + @IsEmail()', () => {
    it('normalises to trimmed lower case', () => {
      const result = registerFormSchema.safeParse({ ...valid, email: '  ADA@Example.COM  ' });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.email).toBe('ada@example.com');
    });

    it('rejects a malformed address', () => {
      expect(registerFormSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    });
  });

  describe('confirmPassword - client-only cross-field rule', () => {
    it('rejects a mismatch', () => {
      const result = registerFormSchema.safeParse({ ...valid, confirmPassword: 'Different1X' });
      expect(result.success).toBe(false);
    });

    it('attaches the error to confirmPassword, not the form root', () => {
      /**
       * THE TEST THAT MATTERS MOST HERE.
       *
       * `.refine()` without `path` attaches the issue to the ROOT, where React
       * Hook Form has no field to display it against. The message renders
       * nowhere and the form silently refuses to submit - "my form won't submit
       * and shows no error" is almost always this.
       *
       * Asserting the path pins the fix in place.
       */
      const result = registerFormSchema.safeParse({ ...valid, confirmPassword: 'Different1X' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(['confirmPassword']);
      }
    });
  });
});

describe('toRegisterPayload', () => {
  it('strips confirmPassword before the request', () => {
    /**
     * `confirmPassword` is a UX device; the backend has no such property. Its
     * ValidationPipe runs with `whitelist: true` so it would be stripped
     * anyway - but sending it would still be sloppy, and the type
     * `Omit<..., 'confirmPassword'>` makes it a compile error rather than a
     * code-review comment.
     */
    expect(toRegisterPayload(valid)).not.toHaveProperty('confirmPassword');
    expect(toRegisterPayload(valid)).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Str0ngPassword',
    });
  });

  it('never sends role - the mass-assignment guard', () => {
    /**
     * The backend's RegisterDto is `OmitType(CreateUserDto, ['role'])`
     * precisely so nobody can POST `{"role":"admin"}` and grant themselves
     * administrator. This asserts the client is not trying to.
     */
    expect(toRegisterPayload(valid)).not.toHaveProperty('role');
  });
});

describe('loginSchema', () => {
  it('requires both fields to be present', () => {
    expect(loginSchema.safeParse({ email: '', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });

  it('does NOT apply the password policy', () => {
    /**
     * DELIBERATELY WEAKER THAN REGISTER, and this test documents why.
     *
     * Applying the strong-password rule to login would lock out any user whose
     * password predates the current policy - telling them their own correct
     * password is invalid, with no way forward. The server decides whether
     * credentials are right; the form only checks they were typed.
     */
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'old' }).success).toBe(true);
  });
});
