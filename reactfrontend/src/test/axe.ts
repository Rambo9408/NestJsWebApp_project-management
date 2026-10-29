import axe, { type AxeResults, type Result } from 'axe-core';
import { expect } from 'vitest';

/**
 * =============================================================================
 * An axe-core helper for component tests
 * =============================================================================
 * WHAT AXE ACTUALLY IS: a rules engine that inspects rendered DOM against WCAG.
 * It catches the MECHANICAL failures — a button with no accessible name, a form
 * control with no label, insufficient contrast, a broken ARIA relationship.
 *
 * -----------------------------------------------------------------------------
 * WHAT IT CANNOT CATCH, and this matters more than what it can
 * -----------------------------------------------------------------------------
 * Automated tooling finds roughly a THIRD of real accessibility problems. It
 * will never tell you that:
 *
 *   - your focus order is illogical, only that focusable things exist
 *   - your alt text says "image1.png"
 *   - a modal traps focus but never returns it to the trigger
 *   - an error is announced but scrolled off-screen
 *   - the page is unusable with a screen reader despite passing every rule
 *
 * So a green axe run is a FLOOR, not a certificate. Saying "we run axe in CI,
 * therefore the app is accessible" is the single most common overclaim in this
 * area, and an interviewer who cares will push on it.
 *
 * The honest framing: axe catches the errors that have no excuse. Everything
 * else needs a keyboard, a screen reader, and a person.
 * =============================================================================
 */

/**
 * jsdom does not do layout — every element reports zero width and height, and
 * no computed colours from a stylesheet. Rules that depend on either produce
 * FALSE RESULTS rather than useful ones, so they are disabled here and must be
 * checked in a real browser instead.
 */
const JSDOM_UNSUPPORTED = {
  /**
   * Contrast needs real rendered colours. In jsdom every element is
   * transparent-on-transparent, so this rule either passes vacuously or reports
   * nonsense. It is the clearest example of why a green jsdom run proves less
   * than it appears to.
   */
  'color-contrast': { enabled: false },
};

export interface AxeCheckOptions {
  /** Rules to switch off for this call, each with a written justification. */
  disable?: Record<string, { enabled: false }>;
}

export async function checkA11y(
  container: HTMLElement,
  options: AxeCheckOptions = {},
): Promise<AxeResults> {
  return axe.run(container, {
    rules: { ...JSDOM_UNSUPPORTED, ...options.disable },
    /**
     * WCAG 2.1 A and AA. Level AAA is deliberately excluded: it includes rules
     * (7:1 contrast, no images of text at all) that most products do not target
     * and that would drown the real failures in noise.
     *
     * AA is the level referenced by most legislation, and the level worth
     * naming when asked "which standard do you target?".
     */
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  });
}

/** Formats violations so a failure names the element and how to fix it. */
export function formatViolations(violations: Result[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `      ${node.html}\n        ${node.failureSummary ?? ''}`)
        .join('\n');
      return `  [${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}\n${nodes}`;
    })
    .join('\n\n');
}

/**
 * Asserts zero violations, printing them readably when there are some.
 *
 * The default vitest diff on an array of axe results is unreadable — a wall of
 * nested objects. A test that fails without telling you WHAT to fix gets
 * skipped, and a skipped accessibility test is worse than none because it looks
 * like coverage.
 */
export async function expectNoA11yViolations(
  container: HTMLElement,
  options: AxeCheckOptions = {},
): Promise<void> {
  const results = await checkA11y(container, options);

  if (results.violations.length > 0) {
    expect.fail(
      `${String(results.violations.length)} accessibility violation(s):\n\n${formatViolations(results.violations)}`,
    );
  }
}
