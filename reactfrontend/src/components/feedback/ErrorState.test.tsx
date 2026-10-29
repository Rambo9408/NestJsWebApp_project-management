import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from './ErrorState';
import { HttpError } from '@/services/httpClient';

/**
 * These tests exist because `describeError` has FOUR branches and a component
 * that renders "[object Object]" to a user is a bug you only find in
 * production. Each branch gets a test - that is what branch coverage means in
 * practice, as opposed to a coverage percentage.
 */
describe('ErrorState', () => {
  it('renders every field error from a validation response', () => {
    /**
     * A REAL 400 from the backend, copied from a live response. Using the
     * actual shape rather than an invented one is the point: if the backend's
     * error contract changes, this test should fail.
     */
    const error = new HttpError(
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
        requestId: 'req-123',
      },
      'Validation failed',
    );

    render(<ErrorState error={error} />);

    // BOTH messages. Rendering only the first is a real and common bug - it
    // makes the user fix one field at a time, one round-trip each.
    expect(screen.getByText(/email must be a valid email address/i)).toBeVisible();
    expect(screen.getByText(/name must be longer than or equal to 2/i)).toBeVisible();
  });

  it('surfaces the requestId so a user can quote it in a bug report', () => {
    const error = new HttpError(
      500,
      {
        success: false,
        statusCode: 500,
        message: 'Internal server error',
        error: 'InternalServerError',
        path: '/api/v1/tasks',
        timestamp: '2026-08-20T06:00:00.000Z',
        requestId: 'req-abc-999',
      },
      'Internal server error',
    );

    render(<ErrorState error={error} />);

    expect(screen.getByText('req-abc-999')).toBeVisible();
  });

  it('falls back to the message of a plain Error', () => {
    render(<ErrorState error={new Error('Failed to fetch')} />);

    expect(screen.getByText('Failed to fetch')).toBeVisible();
  });

  it('renders a safe generic message for a non-Error thrown value', () => {
    /**
     * The branch that justifies typing `error` as `unknown`. A thrown value in
     * JavaScript can be anything, and interpolating it raw would print
     * "[object Object]" - or worse, leak internal data onto the screen.
     */
    render(<ErrorState error={{ unexpected: 'shape' }} />);

    expect(screen.getByText(/an unexpected error occurred/i)).toBeVisible();
  });

  it('announces itself to assistive technology', () => {
    render(<ErrorState error={new Error('boom')} />);

    // `role="alert"` is what makes a screen reader interrupt and read this
    // immediately. Without it a blind user gets no notification that anything
    // failed - the page simply stops responding as they expect.
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it('offers retry only when a handler is supplied', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(<ErrorState error={new Error('boom')} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();

    rerender(<ErrorState error={new Error('boom')} onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
