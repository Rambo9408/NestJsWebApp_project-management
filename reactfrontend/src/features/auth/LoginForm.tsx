import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { FormTextField } from '@/components/forms/FormTextField';
import { paths } from '@/routes/paths';
import { loginSchema, type LoginFormValues } from './authSchemas';
import { HttpError } from '@/services/httpClient';
import type { AuthResponse } from '@/types/api';

/**
 * =============================================================================
 * LoginForm
 * =============================================================================
 * Simpler than RegisterForm on purpose - and the differences are all deliberate
 * rather than incidental.
 * =============================================================================
 */

interface LoginFormProps {
  onLogin: (values: LoginFormValues) => Promise<AuthResponse>;
  onSuccess?: (response: AuthResponse) => void;
}

export function LoginForm({ onLogin, onSuccess }: LoginFormProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    try {
      const response = await onLogin(values);
      onSuccess?.(response);
    } catch (error) {
      /**
       * =====================================================================
       * NO applyServerErrors HERE, AND THAT IS A SECURITY DECISION
       * =====================================================================
       * A failed login must NOT say which field was wrong.
       *
       * "No account with that email" turns the login form into an ACCOUNT
       * ENUMERATION ORACLE: an attacker submits a list of addresses and learns
       * which ones are registered. That leaks the user list, and it is
       * genuinely valuable to a credential-stuffing attack.
       *
       * The backend already refuses to distinguish them - its own Swagger
       * annotation reads "Invalid email or password (deliberately
       * indistinguishable)". Splitting the message client-side would undo that
       * on the client, which is where the attacker is looking.
       *
       * So: one message, attached to the form, never to a field.
       *
       * INTERVIEW: "why not tell the user their email is not registered?" -
       * account enumeration. It is a small question that reliably separates
       * people who have thought about auth from people who have implemented a
       * login form.
       * =====================================================================
       */
      const isCredentialFailure = error instanceof HttpError && error.status === 401;

      setFormError(
        isCredentialFailure
          ? 'Invalid email or password.'
          : error instanceof Error
            ? error.message
            : 'Sign in failed. Please try again.',
      );
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <Stack spacing={2.5}>
        <Typography variant="h5" component="h2">
          Sign in
        </Typography>

        {formError && (
          /*
            MUI gives Alert severity="error" role="alert", so a screen reader
            announces this immediately rather than leaving a blind user pressing
            a button that appears to do nothing.
          */
          <Alert severity="error">{formError}</Alert>
        )}

        <FormTextField
          control={control}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          /*
            `autoFocus` on the FIRST field of a login form is one of the few
            places it is genuinely right: the page exists to be typed into, and
            there is nothing above it to skip past.

            Elsewhere it is usually hostile - it steals focus from a screen
            reader's position and can scroll the page unexpectedly.
          */
          autoFocus
        />

        <FormTextField
          control={control}
          name="password"
          label="Password"
          type="password"
          // `current-password`, unlike the register form's `new-password`. This
          // is what tells a password manager to offer the SAVED credential
          // rather than generating a new one.
          autoComplete="current-password"
        />

        <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </Button>

        <Typography variant="body2" color="text.secondary">
          No account? <Link to={paths.register}>Create one</Link>
        </Typography>
      </Stack>
    </form>
  );
}
