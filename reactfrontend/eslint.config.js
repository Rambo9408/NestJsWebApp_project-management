import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * =============================================================================
 * ESLINT - FLAT CONFIG
 * =============================================================================
 * NOTE: the Vite template now ships `oxlint` instead of ESLint. Oxlint is
 * dramatically faster (Rust) and is a reasonable default. We use ESLint here
 * for two concrete reasons:
 *   1. `react-hooks/exhaustive-deps` is the single most valuable rule in a
 *      React codebase and its ESLint implementation is the reference one.
 *   2. The NestJS backend already uses ESLint flat config. One linter and one
 *      config format across the stack is worth more than the seconds saved.
 *
 * "Flat config" is the array-based format that replaced `.eslintrc`. Each entry
 * applies to the files it matches, and later entries override earlier ones -
 * which is why `prettier` must come last.
 * =============================================================================
 */
export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      /**
       * `recommendedTypeChecked`, not plain `recommended`.
       *
       * The type-aware rules need a TypeScript program, so they are slower -
       * and they catch a class of bug the syntax-only rules structurally
       * cannot. The one that matters most is `no-floating-promises`: an
       * un-awaited promise whose rejection is silently swallowed. In a React
       * app that is a failed mutation the user never hears about.
       *
       * The backend makes the same trade for the same reason.
       */
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /**
       * =====================================================================
       * THE MOST IMPORTANT RULE IN THIS FILE
       * =====================================================================
       * `exhaustive-deps` warns when an effect reads a value it did not
       * declare as a dependency. That omission is the mechanical cause of
       * STALE CLOSURES: the effect captured the value from the render it was
       * created in, and keeps using that snapshot forever while the component
       * moves on.
       *
       * IT IS AN ERROR HERE, NOT A WARNING. Warnings get scrolled past. This
       * rule is right far more often than the developer arguing with it, and
       * when it is genuinely wrong the correct response is a targeted
       * eslint-disable-next-line WITH A COMMENT EXPLAINING WHY - which turns a
       * silent judgement call into a reviewable one.
       *
       * THE ANTI-PATTERN IT PREVENTS: deleting a dependency to stop an
       * infinite loop. That does stop the loop, and it does it by freezing the
       * effect on stale data. The real fix is almost always to stabilise the
       * dependency (useCallback, a ref, or moving it out of the component) or
       * to not need the effect at all.
       *
       * We build examples of every one of these failures in Phase 11.
       * =====================================================================
       */
      'react-hooks/exhaustive-deps': 'error',

      /** Fast Refresh only works reliably if a module exports components alone. */
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /**
       * Unused args prefixed with _ are allowed - the standard escape hatch for
       * "I must accept this parameter to reach the next one".
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      /** console.log left in a component is noise; warn and error are intentional. */
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  /**
   * THE ROUTER IS A CONFIGURATION MODULE, not a component module.
   *
   * `react-refresh/only-export-components` wants every export in a file to be a
   * component so Fast Refresh can swap it while preserving state. router.tsx
   * exports a router OBJECT and declares `lazy()` wrappers at module scope, so
   * it can never satisfy that - and it should not try. Splitting the lazy
   * declarations into a separate file purely to satisfy a lint rule would make
   * the route tree harder to read for no benefit.
   *
   * The practical cost is real but small: editing router.tsx triggers a full
   * reload rather than a hot swap. Route definitions change rarely.
   *
   * SCOPED TO ONE FILE, deliberately. Disabling the rule globally would lose
   * the warning everywhere it IS worth acting on - as it was for
   * ThemeModeProvider, where the fix was a genuine structural improvement.
   */
  {
    files: ['src/app/router.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  /**
   * Config files run in Node and are not part of the app's TS program, so the
   * type-aware rules have nothing to check them against.
   */
  {
    files: ['*.config.{js,ts}', 'src/test/**'],
    ...tseslint.configs.disableTypeChecked,
  },

  /**
   * LAST, ALWAYS. This turns OFF every ESLint rule that overlaps with
   * Prettier's formatting. Without it the two tools fight: ESLint demands a
   * trailing comma, Prettier removes it, and the file never settles.
   *
   * The division of labour: PRETTIER owns formatting, ESLint owns correctness.
   */
  prettier,
);
