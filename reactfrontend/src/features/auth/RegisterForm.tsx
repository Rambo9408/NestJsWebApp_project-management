import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { FormTextField } from '@/components/forms/FormTextField';
import { paths } from '@/routes/paths';
import { registerFormSchema, toRegisterPayload, type RegisterFormValues } from './authSchemas';
import { applyServerErrors } from './applyServerErrors';
import type { AuthResponse } from '@/types/api';

/**
 * =============================================================================
 * RegisterForm - React Hook Form + Zod, wired to the real API contract
 * =============================================================================
 * WHY REACT HOOK FORM AT ALL:
 *
 *   The naive approach is one useState per field. Every keystroke re-renders
 *   the whole form - all six fields, their labels, their helper text. With six
 *   fields nobody notices. With a forty-field settings page on a mid-range
 *   Android phone, typing visibly lags.
 *
 *   RHF keeps values in a ref-backed store OUTSIDE React state and only
 *   re-renders the components that subscribed to what changed. Uncontrolled by
 *   default, controlled where you ask for it.
 *
 * ALTERNATIVES, honestly:
 *   - Formik: the previous default. Controlled and re-renders the whole form on
 *     every keystroke; largely superseded on performance grounds.
 *   - TanStack Form: newer, excellent types, smaller ecosystem.
 *   - Plain useState: genuinely correct for a one-field search box. Reaching
 *     for a form library there is overkill.
 *
 * SHOULD EVERY APP USE IT? No. Use it when forms are a significant part of the
 * app - which for a project-management tool they are.
 *
 * ANGULAR BRIDGE: this is Reactive Forms. `useForm` is `FormGroup`, the Zod
 * resolver is your `ValidatorFn`s, `formState.errors` is `control.errors`, and
 * `handleSubmit` is `(ngSubmit)`. The concepts map almost one-to-one; what
 * differs is that validation lives in a SCHEMA rather than being attached per
 * control.
 * =============================================================================
 */

const FIELDS = ['name', 'email', 'password', 'confirmPassword'] as const;

interface RegisterFormProps {
  /**
   * INJECTED, not imported.
   *
   * The form does not know how registration happens. That keeps it testable
   * without MSW or a network, and it means Phase 7 swaps a real API call and
   * Phase 20 swaps an RTK Query mutation without touching this file.
   *
   * ANGULAR BRIDGE: this is constructor injection, done with a prop. React has
   * no DI container, so "inject the dependency" means "pass it in".
   */
  onRegister: (payload: ReturnType<typeof toRegisterPayload>) => Promise<AuthResponse>;
  onSuccess?: (response: AuthResponse) => void;
}

export function RegisterForm({ onRegister, onSuccess }: RegisterFormProps) {
  /** Errors that could not be attributed to a field - shown above the form. */
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const {
    control,
    handleSubmit,
    setError,
    formState: { isSubmitting },
  } = useForm<RegisterFormValues>({
    /**
     * `zodResolver` is the adapter between Zod and RHF. RHF is
     * schema-library-agnostic - there are resolvers for Yup, Joi, Valibot and
     * others - so the validation library is a swappable decision rather than a
     * commitment baked into every field.
     */
    resolver: zodResolver(registerFormSchema),

    /**
     * `defaultValues` IS NOT OPTIONAL IN PRACTICE.
     *
     * Omit it and each input starts as `undefined`, which React treats as
     * UNCONTROLLED. The first keystroke gives it a value and it becomes
     * CONTROLLED - and React logs the warning "A component is changing an
     * uncontrolled input to be controlled". It is the single most common React
     * form warning, and the fix is always this.
     */
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },

    /**
     * VALIDATION TIMING, and it is a real UX decision rather than a default to
     * accept:
     *
     *   onSubmit (default) - nothing until submit. The user fills six fields
     *                        and is then told about three of them at once.
     *   onChange           - validates every keystroke. "password must be at
     *                        least 10 characters" flashes red from the first
     *                        letter, which reads as the form scolding you for
     *                        typing.
     *   onTouched          - validate a field once it has been blurred, then
     *                        live. Silent while you type it the first time,
     *                        instant feedback once you have moved on and come
     *                        back.
     *
     * `onTouched` is the right default for almost every form. Worth being able
     * to argue for in an interview - most candidates never change it.
     */
    mode: 'onTouched',
  });

  /**
   * `handleSubmit` wraps our handler and does three things: prevents the
   * default page reload, runs validation, and only then calls us - with values
   * already typed and parsed by Zod.
   *
   * The `values` parameter is `RegisterFormValues`, inferred from the schema.
   * No casting, no manual FormData reading.
   */
  const onSubmit = handleSubmit(async (values) => {
    setFormErrors([]);

    try {
      /**
       * `toRegisterPayload` strips `confirmPassword`. It is a client-only
       * field: the backend has no such property, and its ValidationPipe runs
       * with `whitelist: true` so an unexpected property is stripped anyway.
       *
       * Doing it explicitly makes the boundary a TYPE ERROR rather than a
       * convention - `RegisterPayload` is `Omit<..., 'confirmPassword'>`, so
       * sending it would not compile.
       */
      const response = await onRegister(toRegisterPayload(values));
      onSuccess?.(response);
    } catch (error) {
      /**
       * SERVER ERRORS MAPPED BACK ONTO FIELDS. This is where the backend's
       * `message: string[]` earns its keep - see applyServerErrors.
       */
      const { handled, formLevel } = applyServerErrors(error, setError, FIELDS);
      setFormErrors(
        formLevel.length > 0
          ? formLevel
          : handled
            ? []
            : /**
               * THE FALLBACK MATTERS. A 409 (email already registered), a 500,
               * or a dropped connection are not field errors, and silently
               * swallowing them leaves the user staring at a form that did
               * nothing when they pressed the button.
               *
               * "Nothing happened" is the worst possible failure mode, because
               * the user cannot tell whether it worked.
               */
              [error instanceof Error ? error.message : 'Registration failed. Please try again.'],
      );
    }
    /**
     * NO `finally { setSubmitting(false) }` - and no `isSubmitting` state of
     * our own either. RHF derives `isSubmitting` from the returned promise, so
     * it flips back automatically on both success and failure.
     *
     * Hand-rolled submitting flags are a classic source of a permanently
     * disabled button: one early `return` that skips the reset and the form is
     * dead until reload.
     */
  });

  return (
    /**
     * A REAL `<form>` ELEMENT with `onSubmit`, not a `<div>` with a click
     * handler on the button. That is what gives you: Enter-to-submit from any
     * field, the browser's own "this is a form" semantics for screen readers,
     * and password-manager save prompts.
     *
     * `noValidate` turns OFF native browser validation so ours is the only one
     * running. Without it the browser shows its own untranslated, unstyled
     * tooltip and blocks submission before RHF ever sees the event.
     */
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <Stack spacing={2.5}>
        <Typography variant="h5" component="h2">
          Create your account
        </Typography>

        {formErrors.length > 0 && (
          <Alert severity="error">
            {formErrors.map((message) => (
              <Typography key={message} variant="body2">
                {message}
              </Typography>
            ))}
          </Alert>
        )}

        <FormTextField
          control={control}
          name="name"
          label="Name"
          // `autoComplete` is not boilerplate - it is what lets a password
          // manager fill the form and what makes mobile keyboards behave. The
          // values are a defined spec, not free text.
          autoComplete="name"
          helperText="2-80 characters"
        />

        <FormTextField
          control={control}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
        />

        <FormTextField
          control={control}
          name="password"
          label="Password"
          type="password"
          // `new-password` specifically. `current-password` here would make a
          // password manager offer the user's EXISTING password on a signup
          // form, and suppress the offer to generate a strong new one.
          autoComplete="new-password"
          helperText="At least 10 characters, with upper case, lower case and a digit"
        />

        <FormTextField
          control={control}
          name="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
        />

        <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
          {/*
            THE BUTTON IS DISABLED ONLY WHILE SUBMITTING - never on
            `!isValid`.

            A submit button disabled until the form is valid is a common
            anti-pattern: the user cannot press it, and because they never
            pressed it they are never told WHY. On `mode: 'onTouched'` a
            never-touched field has no error yet, so the button is dead with
            nothing highlighted. Let them submit, then show what is wrong.
          */}
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </Button>

        <Typography variant="body2" color="text.secondary">
          Already have an account? <Link to={paths.login}>Sign in</Link>
        </Typography>
      </Stack>
    </form>
  );
}
