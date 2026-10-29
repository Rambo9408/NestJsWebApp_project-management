import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { server } from '@/test/msw/server';
import { RootLayout } from './RootLayout';
import { ThemeModeProvider } from '@/app/providers/ThemeModeProvider';
import authReducer from '@/features/auth/authSlice';
import uiReducer from '@/features/ui/uiSlice';
import { apiSlice } from '@/services/apiSlice';
import { paths } from '@/routes/paths';

/**
 * =============================================================================
 * THE ACCESSIBILITY TESTS AXE CANNOT WRITE
 * =============================================================================
 * The axe pass in `src/a11y.test.tsx` found four component violations and fixed
 * all four. It found NOTHING in this layout - and the two worst accessibility
 * problems in the application were here:
 *
 *   1. no way to bypass six tab stops of chrome on every page
 *   2. navigation was completely silent to a screen reader
 *
 * Both are Level A. Both passed every automated rule. That gap is the entire
 * argument for this file existing, and the reason "we run axe in CI" is not an
 * accessibility strategy.
 *
 * -----------------------------------------------------------------------------
 * WHY THESE ARE TESTABLE IN JSDOM WHEN THE Z-INDEX ONE WAS NOT
 * -----------------------------------------------------------------------------
 * TaskCard.test.tsx has a long note about how jsdom cannot test the overlay's
 * stacking, because jsdom has no layout. The distinction that matters:
 *
 *   NOT TESTABLE   anything decided by LAYOUT - z-order, occlusion, clipping,
 *                  visibility, scroll position, actual pixel focus rings.
 *
 *   TESTABLE       anything in the DOM or the FOCUS MODEL - tab order,
 *                  document.activeElement, ARIA attributes, text content of a
 *                  live region.
 *
 * Focus is not layout. jsdom implements the focus model properly, including
 * `tabIndex` semantics and the tab order userEvent walks. So "does the skip
 * link move focus to main" is a question jsdom can answer honestly, and
 * "is the skip link visible when focused" is not.
 *
 * Knowing which of those two you are asserting is the difference between a test
 * that guards a fix and a test that only looks like it does.
 * =============================================================================
 */

beforeAll(() => {
  // The layout mounts NotificationBell, which opens an SSE stream. It bails out
  // when unauthenticated, but MSW must still be listening or an unexpected
  // request would fail the run.
  server.listen({ onUnhandledRequest: 'bypass' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function renderLayout(initialPath: string = paths.dashboard) {
  const store = configureStore({
    reducer: { auth: authReducer, ui: uiReducer, [apiSlice.reducerPath]: apiSlice.reducer },
    middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
  });

  return render(
    <Provider store={store}>
      {/*
        The REAL ThemeModeProvider, not a stub. RootLayout's ThemeModeToggle
        throws without it - deliberately, because a context hook that silently
        returns undefined is how you get a toggle that does nothing in
        production. That throw is a feature, and here it just means the test
        has to supply the provider.
      */}
      <ThemeModeProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<RootLayout />}>
              <Route path={paths.dashboard} element={<p>dashboard content</p>} />
              <Route path={paths.tasks} element={<p>tasks content</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeModeProvider>
    </Provider>,
  );
}

describe('RootLayout accessibility', () => {
  describe('skip link (WCAG 2.4.1, Bypass Blocks)', () => {
    /**
     * THE ORDERING ASSERTION IS THE POINT.
     *
     * A skip link that is not the first focusable element has already failed:
     * the user has to tab past whatever precedes it to reach the thing that
     * exists to save them tabbing. `user.tab()` from a clean document walks the
     * real tab order, so this asserts the property rather than the markup.
     *
     * VERIFIED LOAD-BEARING: moving <SkipLink /> to sit after <MainNav /> fails
     * this test - focus lands on the first nav link instead.
     *
     * A NUANCE FOUND BY GETTING THE MUTATION WRONG FIRST. The initial attempt
     * moved the skip link merely "below the AppBar" - to the top of the Toolbar
     * - and the test still passed. Correctly: everything before that point (the
     * <h1>, the AppBar itself) is NOT FOCUSABLE, so the link was still the first
     * thing Tab reached.
     *
     * Which is the right behaviour to assert. The requirement is not "first in
     * the DOM", it is "first in the TAB ORDER" - and those differ by exactly the
     * set of non-focusable elements in between. A test asserting DOM position
     * would have failed a correct implementation.
     *
     * The general habit: when a mutation does not break a test, check whether
     * the test is vacuous OR the mutation failed to create the bug. It was the
     * second here, and assuming the first would have led to weakening a test
     * that was already right.
     */
    it('is the very first thing a keyboard user reaches', async () => {
      const user = userEvent.setup();
      renderLayout();

      await user.tab();

      expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveFocus();
    });

    /**
     * THE HALF EVERYONE FORGETS.
     *
     * `href="#main-content"` scrolls, and in a browser that is all it does
     * unless the target is focusable. Without `tabIndex={-1}` on <main> the
     * page appears to jump to the content while FOCUS STAYS ON THE SKIP LINK -
     * so the next Tab goes to the first nav link and the user is back where
     * they started, now confused as well.
     *
     * The assertion is on the focus MODEL, not on the jump: jsdom does not
     * implement fragment navigation, so this checks the property that makes the
     * jump work rather than simulating the jump itself.
     *
     * VERIFIED LOAD-BEARING: removing `tabIndex={-1}` from the <main> Container
     * fails this - `tabIndex` reads -1 only when it is set, and a <main> with
     * no tabIndex is not focusable at all.
     */
    it('targets a main element that is actually focusable', () => {
      renderLayout();

      const skipLink = screen.getByRole('link', { name: /skip to main content/i });
      const main = screen.getByRole('main');

      expect(skipLink).toHaveAttribute('href', `#${main.id}`);
      expect(main.id).not.toBe('');
      // -1: programmatically focusable, but NOT a tab stop of its own.
      expect(main).toHaveAttribute('tabindex', '-1');

      // The focus model, exercised directly - this is what the fragment
      // navigation and the route announcer both rely on.
      main.focus();
      expect(main).toHaveFocus();
    });
  });

  describe('route announcement (the canonical SPA failure)', () => {
    /**
     * A live region announces CHANGES to its text. So the assertion has to be
     * that the text CHANGED after navigation - asserting it merely exists would
     * pass against a hardcoded string that never updates, which announces
     * nothing and looks identical in the DOM.
     *
     * `role="status"` is queried rather than the element, because that is what
     * assistive technology actually keys on. A div with the right text and no
     * role is silent.
     *
     * VERIFIED LOAD-BEARING: hardcoding the announcer's text fails the second
     * assertion while the first still passes - which is exactly the vacuous
     * version of this test.
     */
    it('announces the new page name after navigating', async () => {
      const user = userEvent.setup();
      renderLayout(paths.dashboard);

      const announcer = screen.getByRole('status');
      expect(announcer).toHaveTextContent(/dashboard/i);

      await user.click(screen.getByRole('link', { name: 'Tasks' }));

      expect(screen.getByRole('status')).toHaveTextContent(/tasks/i);
    });

    /**
     * FOCUS MOVES TO MAIN ON NAVIGATION - the other half of the fix.
     *
     * Without this, focus stays on the link the user activated. In a real SPA
     * that link often no longer exists after the swap, at which point the
     * browser resets focus to <body> and the screen reader user's position is
     * gone entirely: no announcement, no context, and Tab starts over from the
     * top of the document.
     *
     * VERIFIED LOAD-BEARING: deleting the `main?.focus()` line fails this -
     * focus remains on the Tasks link.
     */
    it('moves focus to main content on navigation', async () => {
      const user = userEvent.setup();
      renderLayout(paths.dashboard);

      await user.click(screen.getByRole('link', { name: 'Tasks' }));

      expect(screen.getByRole('main')).toHaveFocus();
    });

    /**
     * AND NOT ON FIRST LOAD - the guard that stops the fix becoming a bug.
     *
     * On initial load the browser has already put focus at the top of the
     * document and the screen reader is reading from there. Moving focus into
     * <main> at that moment INTERRUPTS that, and skips the header and nav the
     * user has not heard yet.
     *
     * This is why `isFirstRender` is a ref in RootLayout, and this test is the
     * only thing that would catch someone deleting it - every other test here
     * passes without it.
     */
    it('does not steal focus on the initial render', () => {
      renderLayout(paths.dashboard);

      expect(screen.getByRole('main')).not.toHaveFocus();
      expect(document.body).toHaveFocus();
    });
  });

  describe('landmarks', () => {
    /**
     * ONE main, ONE h1, and a NAMED nav.
     *
     * Landmark navigation is how many screen reader users move around a page -
     * jumping straight to "main" or cycling through navigation regions. Two
     * <main> elements make that ambiguous; an unnamed <nav> announces as
     * "navigation" with nothing to distinguish it from any other.
     *
     * axe's `landmark-one-main` and `page-has-heading-one` rules cover some of
     * this, but they are tagged BEST-PRACTICE rather than WCAG, so the
     * `runOnly` filter in src/test/axe.ts deliberately excludes them. Asserting
     * it here is the deliberate choice to cover it anyway.
     */
    it('has exactly one main landmark and one h1', () => {
      renderLayout();

      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('navigation')).toHaveAccessibleName('Main');
    });
  });
});
