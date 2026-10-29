import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectivityPage } from './ConnectivityPage';

/**
 * =============================================================================
 * PHASE 1 TEST - proving the testing stack works end to end
 * =============================================================================
 * The suite is small on purpose. Phase 44 covers testing strategy properly.
 * What this file establishes now is that Vitest + Testing Library + jsdom are
 * correctly wired, and it demonstrates the two habits that matter most.
 *
 * HABIT 1 - QUERY THE WAY A USER PERCEIVES THE UI.
 * `getByRole('button', { name: /retry/i })` finds the element by its ACCESSIBLE
 * role and name, which is what a screen reader announces. A CSS selector like
 * `.MuiButton-root` would pass while the button was invisible, and would break
 * on a styling change that no user could notice. The accessible query breaks
 * only when the user-facing contract actually breaks - which is the entire
 * point of a test.
 *
 * HABIT 2 - ASSERT ON RENDERED OUTPUT, NEVER ON INTERNALS.
 * There is no way here to read `state.status`, and that is deliberate. A test
 * coupled to internal state has to be rewritten every time you refactor, so it
 * punishes exactly the work you want to encourage.
 *
 * ANGULAR BRIDGE: with TestBed you would reach for `fixture.componentInstance`
 * and assert on the class. RTL removes that option. If your Angular tests
 * leaned on `componentInstance`, the adjustment here is real - but the
 * resulting tests survive refactors far better.
 *
 * NOTE ON MOCKING: we stub `global.fetch` because this is Phase 1. From Phase
 * 45 we use MSW, which intercepts at the network layer instead. MSW is
 * strictly better - it exercises the real fetch call, the real URL, the real
 * headers - and it does not need rewriting when the client stops using `fetch`
 * directly. `vi.stubGlobal` is shown here so the upgrade has a "before".
 * =============================================================================
 */
describe('ConnectivityPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the backend payload once the health check resolves', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok' }),
    } as Response);

    render(<ConnectivityPage />);

    /**
     * `findBy*` is the ASYNC query: it retries until the element appears or
     * times out. `getBy*` would fail immediately, because the fetch resolves
     * on a later microtask than the initial render.
     *
     * Using `findBy` also removes the need for a manual `act()` wrapper - RTL
     * handles the act environment for you, and reaching for `act()` by hand is
     * usually a sign of using the wrong query.
     */
    expect(await screen.findByText(/backend reachable/i)).toBeInTheDocument();
  });

  it('shows an error with a retry action when the backend is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Failed to fetch'));

    render(<ConnectivityPage />);

    // `role="alert"` is asserted rather than the text alone: the role is what
    // makes a screen reader announce the failure immediately. Testing the role
    // tests the accessibility contract, not just the copy.
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to fetch/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('refetches when retry is pressed', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'ok' }),
      } as Response);

    // `userEvent`, not `fireEvent`. userEvent dispatches the FULL sequence a
    // real click produces (pointerdown, mousedown, focus, pointerup, mouseup,
    // click). fireEvent dispatches one synthetic event, so it can pass on a
    // button that a real user could not even focus.
    const user = userEvent.setup();

    render(<ConnectivityPage />);
    await user.click(await screen.findByRole('button', { name: /retry/i }));

    expect(await screen.findByText(/backend reachable/i)).toBeInTheDocument();
  });
});
