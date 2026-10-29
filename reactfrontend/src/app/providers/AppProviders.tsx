import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { useMemo, type ReactNode } from 'react';
import { ThemeModeProvider } from './ThemeModeProvider';
import { useThemeMode } from './themeModeContext';
import { Provider as ReduxProvider } from 'react-redux';
import { store } from '@/app/store';
import { SessionBootstrap } from '@/features/auth/SessionBootstrap';

/**
 * =============================================================================
 * THE PROVIDER COMPOSITION ROOT
 * =============================================================================
 * Every app-wide provider is assembled HERE, in one place, rather than being
 * stacked inside main.tsx or - worse - sprinkled through the tree.
 *
 * WHY IT MATTERS: providers nest, and the nesting ORDER is real. A provider
 * whose value depends on another must sit inside it. Keeping them in one
 * component makes that order reviewable, and it makes tests trivial: a test
 * renders `<AppProviders>` around a component and gets the same environment the
 * app has, instead of reproducing five nested wrappers by hand and drifting.
 *
 * ANGULAR BRIDGE: this is the closest React gets to `AppModule`'s `providers`
 * array / `bootstrapApplication`'s provider list. The important difference:
 * Angular resolves dependencies through an INJECTOR keyed by token, so a
 * component asks for what it wants by type. React Context is POSITIONAL - a
 * component receives whatever the nearest matching Provider above it holds, and
 * if there is none it gets the default value. That is why a missing provider in
 * React is often a confusing `undefined` rather than Angular's loud
 * "NullInjectorError: No provider for X".
 *
 * A useContext hook that throws when it finds no provider is how we recover
 * that loud failure. We build one in the Context phase.
 *
 * BY PHASE 10 this file also holds the Redux `<Provider store={store}>`. It is
 * empty of state today on purpose: adding Redux before there is state to put in
 * it is how projects end up with a store that only holds a boolean.
 * =============================================================================
 */

/**
 * The OUTER provider. Note the split into two components: this one owns the
 * mode state, the inner one CONSUMES it.
 *
 * WHY IT MUST BE SPLIT: a component cannot consume a context it renders itself.
 * `useThemeMode()` called here would look ABOVE this component for a provider
 * and find none. The consumer has to live inside the provider's subtree.
 *
 * That constraint is a direct consequence of Context being POSITIONAL - it is
 * resolved by tree position, not by token like Angular's injector. It catches
 * everyone once.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    /**
     * =========================================================================
     * PROVIDER ORDER, and every level of it is a decision
     * =========================================================================
     *   ReduxProvider        OUTERMOST. Everything below may read the store,
     *                        including the theme provider if it ever moves in.
     *                        Nothing above needs it.
     *   ThemeModeProvider    reads localStorage, provides light/dark.
     *   MuiThemeBridge       turns that mode into a MUI theme.
     *   SessionBootstrap     fires the boot refresh and dispatches to the
     *                        store. It needs Redux (it dispatches) AND the
     *                        theme (RequireAuth renders a themed spinner while
     *                        it works) - so it must sit inside both.
     *
     * THE RULE: a provider goes inside everything it depends on, and outside
     * everything that depends on it. Getting this wrong usually shows up as
     * either a thrown "must be used within a Provider" or - worse - an
     * unstyled flash on boot that only appears on a cold load.
     * =========================================================================
     */
    <ReduxProvider store={store}>
      <ThemeModeProvider>
        <MuiThemeBridge>
          {/*
          SessionBootstrap sits INSIDE the theme, not outside.

          It shows a "Restoring your session..." spinner via RequireAuth, and
          that spinner must be themed - so the theme has to be established
          first. Reversing them gives an unstyled flash on every boot.
        */}
          <SessionBootstrap>{children}</SessionBootstrap>
        </MuiThemeBridge>
      </ThemeModeProvider>
    </ReduxProvider>
  );
}

/** Reads our mode context and builds the MUI theme from it. */
function MuiThemeBridge({ children }: { children: ReactNode }) {
  const { mode } = useThemeMode();

  /**
   * `createTheme` builds a NEW OBJECT every call, and that object becomes a
   * context value for every MUI component in the tree.
   *
   * Without useMemo it would be rebuilt on every render of this component, so
   * every styled component below would see a "changed" theme and re-render -
   * the same Context identity bug documented in ThemeModeProvider, one level up.
   *
   * THIS IS MEMOISATION FOR IDENTITY, NOT FOR SPEED, and the two reasons are
   * worth keeping separate:
   *   - for COST: the computation is expensive, so cache the result
   *   - for IDENTITY: the result must keep the same reference, or something
   *     downstream (a memoised child, an effect dependency, a context) does
   *     unnecessary work
   * `createTheme` is not slow. It is the identity that matters here.
   *
   * `[mode]` is the correct dependency. An empty array would pin the light
   * theme forever and the toggle would silently do nothing; no array at all
   * would rebuild it constantly. Note this is exactly why the theme could NOT
   * be hoisted to module scope once it became mode-dependent - a change in
   * requirements that invalidated the simpler option.
   */
  const theme = useMemo(
    () =>
      createTheme({
        palette: { mode },
        /**
         * RESPECT `prefers-reduced-motion`. This is an accessibility
         * requirement, not a nicety: for users with vestibular disorders,
         * animation can cause genuine nausea and disorientation.
         *
         * Applied as a global style override rather than a theme flag, because
         * it must reach third-party and hand-written CSS too, not only MUI's
         * own transitions. The media query is the platform-level signal the OS
         * already exposes - we do not need a setting in our own UI for it.
         */
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              '@media (prefers-reduced-motion: reduce)': {
                '*, *::before, *::after': {
                  animationDuration: '0.01ms !important',
                  animationIterationCount: '1 !important',
                  transitionDuration: '0.01ms !important',
                  scrollBehavior: 'auto !important',
                },
              },
            },
          },
        },
      }),
    [mode],
  );

  return (
    <ThemeProvider theme={theme}>
      {/*
        CssBaseline is MUI's normalize.css: it strips default browser margins
        and applies the theme's background and typography to <body>. Without
        it, the app inherits inconsistent defaults that differ across browsers.
      */}
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
