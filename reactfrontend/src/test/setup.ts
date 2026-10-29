import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * =============================================================================
 * GLOBAL TEST SETUP
 * =============================================================================
 * Runs once before the test files (wired via `test.setupFiles` in
 * vite.config.ts).
 *
 * `@testing-library/jest-dom/vitest` adds the DOM matchers that make assertions
 * read like intent:
 *     expect(button).toBeDisabled()
 * instead of
 *     expect(button.hasAttribute('disabled')).toBe(true)
 * The failure MESSAGE is the real win - jest-dom prints the element, so a
 * failure tells you what the DOM actually looked like.
 *
 * ANGULAR BRIDGE: this file is `test.ts` / the TestBed setup, but the
 * philosophy differs sharply. TestBed compiles a component in isolation and
 * hands you a fixture with access to the class instance. React Testing Library
 * gives you the RENDERED DOM and nothing else - by design. You cannot reach in
 * and call a method or read internal state.
 *
 * That constraint is the point: a test that asserts on internal state fails
 * when you refactor and passes when the button is invisible. RTL's guiding rule
 * is "the more your tests resemble the way your software is used, the more
 * confidence they can give you", so you query by what a USER perceives - role,
 * label, text - and assert on what they would see.
 *
 * Practical consequence for you: `getByRole('button', { name: /save/i })` is
 * the idiomatic query, and it only works if the markup is accessible. Bad
 * accessibility makes tests hard to write, which is a feedback loop worth
 * having. Phase 19 and Phase 44 lean on this.
 * =============================================================================
 */

/**
 * Unmount everything after each test.
 *
 * Vitest's `globals: true` normally makes RTL auto-cleanup, but declaring it
 * explicitly means the suite does not silently depend on that setting. Without
 * cleanup, components from a finished test stay mounted and the next
 * `getByRole` finds two matching elements - a confusing "found multiple
 * elements" failure in a test that looks correct.
 */
afterEach(() => {
  cleanup();
});
