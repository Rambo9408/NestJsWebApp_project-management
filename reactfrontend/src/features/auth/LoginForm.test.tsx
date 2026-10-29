import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { HttpError } from '@/services/httpClient';
import { Role, type AuthResponse } from '@/types/api';

/**
 * =============================================================================
 * TESTING FORMS
 * =============================================================================
 * `MemoryRouter` because both forms contain a `<Link>`, and a Link outside a
 * router throws. MemoryRouter keeps history in memory - no jsdom URL games, no
 * cleanup between tests.
 *
 * THE DEPENDENCY IS INJECTED, so there is no MSW here and no network. That is
 * the pay-off for `onLogin` being a prop: these tests exercise the form's real
 * behaviour - validation timing, submit state, error mapping - without a
 * transport layer in the way. Phase 45 adds MSW for the integration tests that
 * genuinely need to exercise the wire.
 * =============================================================================
 */

const authResponse: AuthResponse = {
  user: {
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    role: Role.MEMBER,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  accessToken: 'token',
  expiresIn: 900,
};

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('LoginForm', () => {
  it('submits trimmed, lower-cased credentials', async () => {
    const onLogin = vi.fn().mockResolvedValue(authResponse);
    const user = userEvent.setup();

    renderInRouter(<LoginForm onLogin={onLogin} />);

    await user.type(screen.getByLabelText(/email/i), '  ADA@Example.COM  ');
    await user.type(screen.getByLabelText(/password/i), 'Str0ngPassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    /**
     * Asserting the NORMALISED value, not what was typed. Zod's
     * `.trim().toLowerCase()` runs as part of parsing, so the handler receives
     * clean data - matching what the backend's `@TrimLower()` would do to it
     * anyway.
     *
     * Without this, a user with a trailing space would be told their correct
     * password is wrong.
     */
    expect(onLogin).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'Str0ngPassword',
    });
  });

  it('does not submit when a field is empty', async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();

    renderInRouter(<LoginForm onLogin={onLogin} />);
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(onLogin).not.toHaveBeenCalled();
  });

  it('shows an indistinguishable message on 401 - no account enumeration', async () => {
    /**
     * =========================================================================
     * A SECURITY TEST, and the most important one in this file.
     * =========================================================================
     * A failed login must never reveal WHICH field was wrong. "No account with
     * that email" turns the form into an account-enumeration oracle: submit a
     * list of addresses, learn which are registered, feed the hits to a
     * credential-stuffing run.
     *
     * The backend already refuses to distinguish them - its Swagger annotation
     * literally reads "deliberately indistinguishable". This asserts the client
     * does not undo that.
     *
     * It is a test worth having because the "improvement" that breaks it looks
     * like better UX. Someone will eventually propose it.
     * =========================================================================
     */
    const onLogin = vi
      .fn()
      .mockRejectedValue(
        new HttpError(
          401,
          {
            success: false,
            statusCode: 401,
            message: 'Unauthorized',
            error: 'UnauthorizedException',
            path: '/api/v1/auth/login',
            timestamp: '2026-08-20T06:00:00.000Z',
          },
          'Unauthorized',
        ),
      );
    const user = userEvent.setup();

    renderInRouter(<LoginForm onLogin={onLogin} />);
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/invalid email or password/i);
    // The message must not name a field.
    expect(alert).not.toHaveTextContent(/no account/i);
    expect(alert).not.toHaveTextContent(/not registered/i);
  });

  it('re-enables the button after a failed submit', async () => {
    /**
     * A form that stays disabled after an error is unusable, and it is a very
     * common bug when `isSubmitting` is hand-rolled with a `finally` that some
     * early return skips.
     *
     * RHF derives it from the returned promise, so it resets on rejection too.
     * This test pins that behaviour against a future refactor to manual state.
     */
    const onLogin = vi.fn().mockRejectedValue(new Error('Network down'));
    const user = userEvent.setup();

    renderInRouter(<LoginForm onLogin={onLogin} />);
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/password/i), 'whatever');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });
});

describe('RegisterForm', () => {
  async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/^name$/i), 'Ada Lovelace');
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Str0ngPassword');
    await user.type(screen.getByLabelText(/confirm password/i), 'Str0ngPassword');
  }

  it('strips confirmPassword from the payload', async () => {
    const onRegister = vi.fn().mockResolvedValue(authResponse);
    const user = userEvent.setup();

    renderInRouter(<RegisterForm onRegister={onRegister} />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(onRegister).toHaveBeenCalledWith({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Str0ngPassword',
    });
  });

  it('blocks submission when the passwords differ', async () => {
    const onRegister = vi.fn();
    const user = userEvent.setup();

    renderInRouter(<RegisterForm onRegister={onRegister} />);
    await fillValidForm(user);
    await user.clear(screen.getByLabelText(/confirm password/i));
    await user.type(screen.getByLabelText(/confirm password/i), 'Different1X');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(onRegister).not.toHaveBeenCalled();
    // The `path: ['confirmPassword']` in the refine is what puts the message
    // here rather than nowhere.
    expect(await screen.findByText(/passwords do not match/i)).toBeVisible();
  });

  it('maps a 400 from the server onto the individual fields', async () => {
    /**
     * =========================================================================
     * THE PAY-OFF FOR THE BACKEND'S `message: string[]`
     * =========================================================================
     * The exception filter deliberately preserves the ARRAY - its comment says
     * that is "what lets a frontend show one message per field". This is that
     * frontend, and this test proves the wiring works.
     *
     * The messages below are copied verbatim from a real 400 captured in
     * Phase 1.
     * =========================================================================
     */
    const onRegister = vi.fn().mockRejectedValue(
      new HttpError(
        400,
        {
          success: false,
          statusCode: 400,
          message: [
            'email must be a valid email address',
            'name must be longer than or equal to 2 characters',
          ],
          error: 'BadRequestException',
          path: '/api/v1/auth/register',
          timestamp: '2026-08-20T06:00:00.000Z',
          requestId: 'req-1',
        },
        'Validation failed',
      ),
    );
    const user = userEvent.setup();

    renderInRouter(<RegisterForm onRegister={onRegister} />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    // Each message rendered against its own field, not lumped into one banner.
    expect(await screen.findByText(/email must be a valid email address/i)).toBeVisible();
    expect(screen.getByText(/name must be longer than or equal to 2/i)).toBeVisible();
  });

  it('shows a form-level error for a failure that is not field-specific', async () => {
    // A 409 (email already registered) is about the request, not one input.
    // Attaching it to a field would be misleading; dropping it would leave the
    // user staring at a form that did nothing.
    const onRegister = vi.fn().mockRejectedValue(new Error('Email already registered'));
    const user = userEvent.setup();

    renderInRouter(<RegisterForm onRegister={onRegister} />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/email already registered/i);
  });
});
