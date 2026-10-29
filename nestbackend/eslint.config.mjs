// @ts-check
/**
 * ESLint 9 "flat config".
 *
 * Why type-aware linting (projectService: true)? Because rules like
 * `no-floating-promises` need the type checker to know a value is a Promise.
 * In a Nest app, a forgotten `await` on a Mongoose call or a queue `.add()` is
 * a real production bug (unhandled rejection -> process crash on Node 15+),
 * so this rule is worth the slower lint run.
 */
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Nest decorators + reflect-metadata legitimately produce `any` in a few
      // framework-boundary places. We warn instead of error so the codebase
      // stays honest without becoming unlintable, but requirement #45 says
      // "no unnecessary any" - treat every warning as debt to justify.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // Real bug catchers - keep these as errors.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Nest interfaces are often implemented with empty method bodies during
      // scaffolding; but empty *catch* blocks hide errors. Keep default.
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    /**
     * SPEC FILES: relax the `any`-safety rules.
     *
     * This is a deliberate, bounded exception rather than laziness. Supertest
     * types `response.body` as `any` by design - it cannot know your response
     * shape - so an integration test that reads `response.body.id` trips five
     * unsafe-* rules per assertion. The alternatives are worse: casting every
     * body to a hand-written interface duplicates the DTOs and drifts from
     * them, and blanket-disabling the rules project-wide would lose them where
     * they matter.
     *
     * The rules that catch REAL bugs (`no-floating-promises`,
     * `no-misused-promises`) stay on everywhere, including here - an
     * un-awaited assertion in a test is a test that cannot fail.
     */
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
