/**
 * =============================================================================
 * CACHE KEY CONVENTIONS
 * =============================================================================
 * Cache keys are a public interface between parts of your system that never
 * call each other. Two modules that build the same key by hand will eventually
 * disagree - one writes `project:123`, another reads `projects:123`, and the
 * cache silently never hits. Nobody notices, because the application still
 * works; it is just slower than it should be, forever.
 *
 * THE RULES this file encodes:
 *
 *   1. ONE PLACE builds every key. A typo becomes a compile error.
 *   2. COLON-SEPARATED, most general to most specific: `entity:id:aspect`.
 *      That ordering is what makes prefix invalidation possible.
 *   3. NO USER INPUT UNESCAPED. A key containing a raw search string can
 *      contain `*`, which turns an invalidation pattern into a much wider
 *      match than intended.
 *   4. VERSION anything whose SHAPE can change. When the serialised form of a
 *      project changes, `v2:` makes every old entry unreachable instead of
 *      deserialising into the wrong type - a deploy-time bug that is very hard
 *      to reproduce afterwards.
 *
 * NOTE the global prefix (`taskflow:dev:`) is applied by ioredis itself via
 * `keyPrefix` (Phase 3), so it does not appear here. That separation matters:
 * environment isolation is an infrastructure concern, key structure is an
 * application one.
 * =============================================================================
 */

/** Bump when the cached SHAPE changes, to orphan every old entry at once. */
const VERSION = 'v1';

export const cacheKeys = {
  /** A single project document. */
  project: (id: string): string => `${VERSION}:project:${id}`,

  /**
   * Everything under one project - the pattern used to invalidate on write.
   *
   * Note it ends WITHOUT a wildcard: `delByPrefix` appends `*`. Keeping the
   * wildcard out of the key builder means a key and its invalidation pattern
   * cannot drift apart.
   */
  projectScope: (id: string): string => `${VERSION}:project:${id}`,

  /** Task statistics for a project - expensive to compute, cheap to cache. */
  projectTaskStats: (id: string): string => `${VERSION}:project:${id}:task-stats`,

  /** A single user, used by the auth path on every authenticated request. */
  user: (id: string): string => `${VERSION}:user:${id}`,
};
