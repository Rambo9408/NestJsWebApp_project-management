import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '@/test/msw/server';
import { authState, callCounts } from '@/test/msw/handlers';
import { LoginPage } from '@/pages/LoginPage';
import authReducer, { selectCurrentUser } from './authSlice';
import uiReducer from '@/features/ui/uiSlice';
import { apiSlice } from '@/services/apiSlice';
import { tokenStore } from './tokenStore';
import { __resetRefreshState } from '@/services/refreshClient';

/**
 * =============================================================================
 * A FULL FLOW - form to store to navigation, over a real network call
 * =============================================================================
 * WHERE THIS SITS IN THE PYRAMID, and why all three layers exist:
 *
 *   UNIT          LoginForm.test.tsx      injects a fake `onLogin`.
 *                                         Tests validation, submit state, the
 *                                         indistinguishable 401 message.
 *                                         Fast. Knows nothing about HTTP.
 *
 *   INTEGRATION   httpClient.integration  real fetch, MSW answers.
 *                                         Tests headers, retry, error parsing.
 *                                         No React at all.
 *
 *   FLOW (this)   the page + the store + the router + the transport.
 *                 Tests that the PIECES ARE WIRED TOGETHER.
 *
 * The third layer is the one people skip, and it catches a specific class of
 * bug the other two structurally cannot: everything works in isolation and
 * nothing is connected. A form that validates perfectly and never dispatches;
 * a store that updates and a page that never navigates.
 *
 * WHAT IT IS NOT: an end-to-end test. There is no browser and no real backend -
 * that is Playwright's job, and it belongs in CI against a running stack. This
 * is the cheapest test that can still catch a wiring bug.
 * =============================================================================
 */

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

beforeEach(() => {
  tokenStore.clear();
  __resetRefreshState();
  callCounts.reset();
  authState.reset();
});

/**
 * A REAL STORE, not a mocked one.
 *
 * Mocking `useAppDispatch` would test that a function was called; using the
 * real store tests that the ACTION the page dispatches actually produces the
 * state the app then reads. Those are different claims, and only the second one
 * catches a mismatched action payload.
 */
function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      ui: uiReducer,
      [apiSlice.reducerPath]: apiSlice.reducer,
    },
    middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
  });
}

function renderLogin(store: ReturnType<typeof makeStore>, initialEntry = '/login') {
  function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  }

  return render(
    <Wrapper>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/*
            A STAND-IN destination, so "did it navigate?" is observable without
            mounting the real dashboard and everything it fetches.

            Asserting on rendered output rather than spying on `useNavigate` -
            a spy proves the function was called, this proves the user ended up
            somewhere.
          */}
          <Route path="/dashboard" element={<h1>Dashboard</h1>} />
          <Route path="/tasks/abc123" element={<h1>Task abc123</h1>} />
        </Routes>
      </MemoryRouter>
    </Wrapper>,
  );
}

describe('login flow (integration)', () => {
  it('signs in, stores the session, and navigates to the dashboard', async () => {
    const store = makeStore();
    const user = userEvent.setup();

    renderLogin(store);

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Str0ngPassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // 1. NAVIGATION happened - the user is somewhere new.
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // 2. The STORE holds the user, so the header and guards will work.
    expect(selectCurrentUser(store.getState())?.email).toBe('ada@example.com');

    /**
     * 3. THE TOKEN IS IN MEMORY, NOT IN THE STORE.
     *
     * A deliberate split: the user drives UI so it belongs in Redux; the token
     * drives requests and must stay out of the devtools log and out of any
     * state-persistence layer added later.
     *
     * Asserting BOTH halves is what pins the design - a refactor that "tidied"
     * the token into the store would pass a looser test.
     */
    expect(tokenStore.get()).toBe('access-token-1');
  });

  it('shows an indistinguishable error on bad credentials and does not navigate', async () => {
    const store = makeStore();
    const user = userEvent.setup();

    renderLogin(store);

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/invalid email or password/i);

    // The message must not name a field - that would make the form an account
    // enumeration oracle. The backend refuses to distinguish; so must we.
    expect(alert).not.toHaveTextContent(/no account/i);

    // Still on the login page, and no session was created.
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(selectCurrentUser(store.getState())).toBeNull();
    expect(tokenStore.get()).toBeNull();
  });

  it('returns the user to the page they originally wanted', async () => {
    /**
     * THE REDIRECT-BACK FLOW, which spans three files: `RequireAuth` captures
     * the location, the router carries it in history state, `LoginPage`
     * narrows it and navigates.
     *
     * No unit test can cover that - each piece is correct in isolation. This is
     * exactly the wiring bug the flow layer exists to catch.
     */
    const store = makeStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <MemoryRouter
          initialEntries={[
            // Shaped exactly as RequireAuth pushes it.
            { pathname: '/login', state: { from: { pathname: '/tasks/abc123' } } },
          ]}
        >
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<h1>Dashboard</h1>} />
            <Route path="/tasks/abc123" element={<h1>Task abc123</h1>} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Str0ngPassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Task abc123' })).toBeVisible();
  });

  it('ignores a hostile redirect target and falls back to the dashboard', async () => {
    /**
     * THE OPEN-REDIRECT GUARD, exercised through the real flow.
     *
     * `//evil.example` is protocol-relative: it starts with a slash and is NOT
     * local. A naive `startsWith('/')` check passes it, which is the classic
     * bypass - and it would send a freshly-authenticated user to an attacker's
     * pixel-perfect copy of the app, arrived at from the real domain.
     *
     * `redirectTargetFrom` rejects it; this asserts the rejection actually
     * reaches navigation rather than being computed and ignored.
     */
    const store = makeStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <MemoryRouter
          initialEntries={[
            { pathname: '/login', state: { from: { pathname: '//evil.example/login' } } },
          ]}
        >
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<h1>Dashboard</h1>} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Str0ngPassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
