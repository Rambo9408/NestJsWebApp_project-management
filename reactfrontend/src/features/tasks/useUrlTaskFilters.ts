import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  INITIAL_TASK_FILTERS,
  toListTasksQuery,
  type TaskFiltersState,
} from './useTaskFilters';
import { TaskPriority, TaskStatus } from '@/types/api';

/**
 * =============================================================================
 * THE URL AS THE SOURCE OF TRUTH FOR FILTER STATE
 * =============================================================================
 * Same state shape as `useTaskFilters`, stored in the query string instead of
 * a reducer.
 *
 * WHERE SHOULD FILTER STATE LIVE? The answer is not "wherever is convenient" -
 * it follows from one question: SHOULD THIS SURVIVE A REFRESH OR A SHARED LINK?
 *
 *   COMPONENT STATE   ephemeral, private to one screen.
 *                     A modal's open/closed, a hover, an unsaved draft.
 *
 *   URL               anything that describes WHAT THE USER IS LOOKING AT.
 *                     Filters, sort, page, search, selected tab.
 *
 *   REDUX             cross-cutting CLIENT state several unrelated features
 *                     read. Rare. Most candidates are really URL or server
 *                     state in disguise.
 *
 *   RTK QUERY         server data. Never hand-copied into a slice.
 *
 * FOUR THINGS THE URL GIVES YOU FOR FREE, none of which component state can:
 *   1. SHAREABLE - "look at these urgent tasks" is a link, not instructions.
 *   2. REFRESH-SAFE - F5 does not throw the user back to an unfiltered list.
 *   3. THE BACK BUTTON WORKS - each filter change is a history entry, so Back
 *      undoes a filter. Users expect this and are confused when it exits the
 *      page instead.
 *   4. BOOKMARKABLE and pasteable into a bug report.
 *
 * THE COST, stated honestly: the URL is strings. Everything must be parsed on
 * read and serialised on write, and anyone can type nonsense into it - so
 * parsing must be DEFENSIVE, which is most of the code below. Component state
 * needs none of that.
 *
 * ANGULAR BRIDGE: this is `ActivatedRoute.queryParams` +
 * `router.navigate([], {queryParams})`. Angular gives you an Observable; React
 * Router gives you a value plus a setter, which is the useState shape you
 * already know.
 *
 * INTERVIEW ("where do you put filter state?"): lead with the refresh-and-share
 * test. It is the question that actually decides it, and most candidates answer
 * "Redux" reflexively.
 * =============================================================================
 */

/**
 * DEFENSIVE PARSING - and this is not paranoia.
 *
 * `?status=banana` is one keystroke away for any user, and it is what an old
 * bookmark looks like after you rename a status. Trusting the string would send
 * `?status=banana` to the API, which fails `@IsEnum(TaskStatus)` with a 400 -
 * so a typo in the address bar becomes an error screen.
 *
 * Falling back to 'all' means a malformed URL degrades to a sane view instead.
 *
 * THE GENERAL PRINCIPLE, and it is the same one from Phase 1: the URL is an
 * UNTRUSTED BOUNDARY, exactly like the network and localStorage. Validate at
 * every boundary; trust only what you have checked.
 */
function parseEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | 'all' {
  /**
   * `allowed.includes(value as T)` needs the cast because `includes` is typed
   * to accept only T. The cast is safe precisely BECAUSE we are checking - the
   * result of the check is what narrows it. This is one of the few places an
   * assertion is honest rather than a lie to the compiler.
   */
  return value !== null && allowed.includes(value as T) ? (value as T) : 'all';
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  // `Number.isInteger` rejects NaN, Infinity and 1.5 in one call - unlike
  // parseInt, which happily turns "12abc" into 12 and "" into NaN.
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const STATUSES = Object.values(TaskStatus);
const PRIORITIES = Object.values(TaskPriority);

export function useUrlTaskFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * DERIVED FROM THE URL, not mirrored into state.
   *
   * There is deliberately no `useState` here. Copying the URL into state would
   * create the second source of truth Phase 2 and Phase 3 both warned about,
   * and it would need an effect to keep them in sync - which is the anti-pattern
   * those phases exist to kill.
   *
   * `searchParams` already changes on navigation, so this component re-renders
   * and re-derives. The URL IS the state.
   *
   * `useMemo` here is for IDENTITY, not cost: parsing five params is trivial,
   * but this object flows into `toListTasksQuery` and will become an RTK Query
   * argument in Phase 20 - where a new reference on every render would defeat
   * the cache and refetch continuously.
   */
  const filters = useMemo<TaskFiltersState>(
    () => ({
      search: searchParams.get('search') ?? '',
      status: parseEnum(searchParams.get('status'), STATUSES),
      priority: parseEnum(searchParams.get('priority'), PRIORITIES),
      page: parsePositiveInt(searchParams.get('page'), INITIAL_TASK_FILTERS.page),
      limit: parsePositiveInt(searchParams.get('limit'), INITIAL_TASK_FILTERS.limit),
    }),
    [searchParams],
  );

  /**
   * ONE SETTER that takes a partial update, so the PAGE-RESET INVARIANT lives
   * in exactly one place - the same guarantee the reducer gave us in Phase 3,
   * preserved now that the storage has moved to the URL.
   *
   * The invariant is not a nice-to-have: filter to "urgent" while on page 4 and
   * you get an empty list that reads as "no results" and is really pagination.
   */
  const setFilters = useCallback(
    (patch: Partial<TaskFiltersState>) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);

          for (const [key, value] of Object.entries(patch)) {
            /**
             * DELETE rather than set-to-empty. `?search=` and no `search` at
             * all are different URLs that mean the same thing, and the shorter
             * one is the shareable one. It also keeps the URL honest: what you
             * see is what is filtered.
             */
            if (value === '' || value === 'all' || value === undefined) {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }

          // THE INVARIANT. Any change other than the page itself resets to 1.
          if (!('page' in patch)) next.delete('page');

          return next;
        },
        {
          /**
           * `replace: false` (the default) pushes a history entry, so Back
           * undoes one filter change. That is right for a deliberate filter
           * click.
           *
           * For a SEARCH BOX you usually want `replace: true`, or every
           * keystroke becomes a history entry and the user must press Back
           * fourteen times to escape. Phase 20 makes the search input use
           * replace while the dropdowns push - a small detail that users notice
           * immediately when it is wrong.
           */
          replace: false,
        },
      );
    },
    [setSearchParams],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: false });
  }, [setSearchParams]);

  return {
    filters,
    setFilters,
    resetFilters,
    /** Reuses the SAME adapter the reducer version uses - see useTaskFilters. */
    query: toListTasksQuery(filters),
    /** Drives the "clear filters" affordance and the empty state's copy. */
    isFiltered:
      filters.search !== '' || filters.status !== 'all' || filters.priority !== 'all',
  };
}
