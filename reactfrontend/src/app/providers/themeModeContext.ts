import { createContext, use } from 'react';

/**
 * =============================================================================
 * The context object and its consumer hook - deliberately in a .ts file,
 * SEPARATE from the provider component.
 * =============================================================================
 * WHY THE SPLIT: React Fast Refresh can only hot-reload a module whose exports
 * are all components. A file exporting both `ThemeModeProvider` (a component)
 * and `useThemeMode` (a hook) breaks that guarantee, so editing it forces a
 * full page reload instead of preserving state - which is exactly the
 * developer-experience win Vite exists to provide.
 *
 * The `react-refresh/only-export-components` lint rule catches it. It reads as
 * a nitpick and is not: the alternative is losing your app state on every save
 * while working on the provider.
 *
 * This is also just better structure. The context and its consumer are a
 * contract; the provider is one implementation of it. A test can supply a
 * different provider around the same context without importing the real one.
 * =============================================================================
 */

export type ThemeMode = 'light' | 'dark';

export interface ThemeModeContextValue {
  mode: ThemeMode;
  toggleMode: () => void;
}

/**
 * `undefined` as the default, deliberately.
 *
 * The alternative - `createContext({ mode: 'light', toggleMode: () => {} })` -
 * looks friendlier and hides bugs. A component rendered outside the provider
 * would silently get a no-op `toggleMode`, and you would spend an afternoon
 * wondering why a button does nothing.
 *
 * With `undefined`, "no provider" is DETECTABLE, and the hook below turns it
 * into an immediate, named error.
 *
 * NOT exported. Consumers use the hook; nobody gets the raw context, so nobody
 * can bypass the check below.
 */
const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined);

/** Internal - only the provider component needs this. */
export const ThemeModeContextInternal = ThemeModeContext;

/**
 * THE THROWING CONSUMER HOOK.
 *
 * Two things it buys, both worth having:
 *   1. A real error instead of `undefined` when a provider is missing. This is
 *      the React equivalent of Angular's `NullInjectorError` - it turns a
 *      confusing runtime failure into a message that names the fix.
 *   2. `ThemeModeContextValue` instead of `ThemeModeContextValue | undefined`,
 *      so no consumer needs a null check. The narrowing happens once, here.
 *
 * NOTE `use()` RATHER THAN `useContext()`. `use` is the modern React API for
 * reading a context; it does the same job and, unlike `useContext`, may be
 * called conditionally. `useContext` remains valid and is what most material
 * still shows - knowing both, and which is newer, is a cheap signal of currency.
 */
export function useThemeMode(): ThemeModeContextValue {
  const context = use(ThemeModeContext);

  if (context === undefined) {
    throw new Error('useThemeMode must be used within a ThemeModeProvider');
  }

  return context;
}
