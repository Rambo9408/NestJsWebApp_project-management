import { matchRoutes, type RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { routes } from './router';
import { paths } from '@/routes/paths';

/**
 * =============================================================================
 * THE TEST THAT WOULD HAVE CAUGHT A DEAD ROUTE
 * =============================================================================
 * `paths.taskDetail` was declared in routes/paths.ts and matched no route for
 * several phases. Every link to a task detail page hit the `path: '*'`
 * fallback and rendered a plausible-looking "not found" page.
 *
 * WHY NOTHING ELSE CAUGHT IT — and this is the transferable part, because the
 * same shape has now appeared three times in this project:
 *
 *   - TypeScript: `paths.taskDetail` is a valid string. A constant that is
 *     never routed is not a type error.
 *   - ESLint: the object IS used, so no unused-variable rule fires.
 *   - The unit tests: nothing rendered the route, so nothing failed.
 *   - The 404 route: `path: '*'` converts the failure into a legitimate page.
 *     There is no error, no console warning, no red anything.
 *
 * The other two instances were a `@Throttle` decorator that appeared only
 * inside a comment claiming it was used, and an `activity-logs:read` capability
 * that guarded a page which did not exist. All three are the same category:
 *
 *   **A DECLARATION THAT READS AS AN IMPLEMENTATION.**
 *
 * Nothing verifies that a declared intent is wired to an effect, because the
 * declaration is individually valid. The only defence is a test that asserts
 * the CONNECTION rather than either end of it — which is what this file is.
 *
 * INTERVIEW: "how do you test routing?" A weak answer renders a page and
 * asserts on its content. A strong one notices that the interesting failure is
 * a route that does not exist, and that testing each page in isolation cannot
 * see it.
 * =============================================================================
 */

/** Every value in the paths object, as a concrete URL. */
function concreteUrl(path: string): string {
  /**
   * Dynamic segments get a plausible id substituted.
   *
   * `matchRoutes` matches on the PATTERN, so any non-empty value works — but a
   * realistic-looking ObjectId keeps a failure message readable when it prints
   * the URL that did not match.
   */
  return path
    .replace(':taskId', '507f1f77bcf86cd799439011')
    .replace(':projectId', '507f1f77bcf86cd799439012');
}

/**
 * Walks the nested route tree and collects every `path` that is declared.
 *
 * Needed because `routes` is a TREE — layout routes, guard routes and
 * pathless wrapper routes nest real paths several levels down. A shallow check
 * would pass while missing everything below the first layout.
 */
function collectPaths(routeObjects: RouteObject[], parent = ''): string[] {
  return routeObjects.flatMap((route) => {
    const own = route.path
      ? route.path.startsWith('/')
        ? route.path
        : `${parent}/${route.path}`
      : parent;
    const children = route.children ? collectPaths(route.children, own) : [];
    return route.path ? [own, ...children] : children;
  });
}

describe('router', () => {
  /**
   * THE CORE ASSERTION.
   *
   * Every entry in `paths` must resolve to a route that is NOT the catch-all.
   *
   * Checking "does it match something" is not enough: `path: '*'` matches
   * literally everything, so a naive `matchRoutes(...) !== null` passes for a
   * URL with no route at all. That would be a vacuous test of exactly the kind
   * Phase 18-19 kept finding — and it is the version most people write.
   *
   * VERIFIED LOAD-BEARING: removing the `paths.taskDetail` route entry makes
   * this fail with "/tasks/:taskId resolves only to the catch-all". Confirmed
   * by actually deleting it and running the suite, not by assuming.
   */
  it.each(Object.entries(paths))('%s (%s) resolves to a real route', (_name, path) => {
    const url = concreteUrl(path);
    const matches = matchRoutes(routes, url);

    expect(matches, `${path} matched no route at all`).not.toBeNull();

    const leaf = matches?.[matches.length - 1];
    expect(leaf?.route.path, `${path} resolves only to the catch-all (404)`).not.toBe('*');
  });

  /**
   * THE REVERSE DIRECTION, which catches a different bug.
   *
   * The test above finds constants with no route. This one finds routes with no
   * constant — a page reachable only by a hardcoded string somewhere in the
   * codebase, which is how link rot starts: the route is renamed, the constant
   * users are updated, and the hardcoded one is missed.
   *
   * The catch-all is excluded because it is deliberately not a named path.
   */
  it('has no route that is missing from the paths object', () => {
    /**
     * `Set<string>` explicitly, because `paths` is `as const`.
     *
     * Without the annotation this infers `Set<"/" | "/login" | ...>`, and
     * `.has(someString)` is then a compile error — TypeScript refuses to check
     * membership of a value that could not possibly be in the set.
     *
     * That strictness is usually a feature (it catches typo'd lookups), and
     * here it is exactly backwards: the whole point is to test strings that
     * might NOT be declared. Widening deliberately, rather than casting the
     * argument, keeps the intent visible.
     */
    const declared = new Set<string>(Object.values(paths));
    const routed = collectPaths(routes).filter((path) => !path.includes('*'));

    const orphans = routed.filter((path) => !declared.has(path));

    expect(orphans, `routes not declared in paths: ${orphans.join(', ')}`).toEqual([]);
  });

  /**
   * AND THE THIRD INSTANCE OF THE SAME PATTERN.
   *
   * `activity-logs:read` existed as a capability, with a passing unit test
   * asserting only admins hold it, guarding a page that had never been built.
   *
   * This asserts that the admin paths the nav can link to actually exist. It is
   * narrow on purpose — a general "every capability maps to a route" rule would
   * be wrong, since most capabilities gate buttons rather than pages.
   */
  it('routes the admin pages that navigation links to', () => {
    for (const path of [paths.adminUsers, paths.adminActivity]) {
      const matches = matchRoutes(routes, path);
      expect(matches?.[matches.length - 1]?.route.path, `${path} is not routed`).toBe(path);
    }
  });
});
