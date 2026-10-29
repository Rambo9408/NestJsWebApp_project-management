
import type { ListTasksQuery, TaskPriority, TaskStatus } from '@/types/api';

/**
 * =============================================================================
 * useReducer - and the honest answer to "useState or useReducer?"
 * =============================================================================
 * THE SHALLOW ANSWER, which is wrong: "useReducer for complex state".
 * "Complex" is not a criterion anybody can apply.
 *
 * THE REAL CRITERION: use a reducer when the next state depends on the previous
 * state AND several fields must change TOGETHER to stay consistent.
 *
 * This filter state is the textbook case, because of one rule that is easy to
 * state and easy to forget:
 *
 *     ANY CHANGE TO A FILTER MUST RESET THE PAGE TO 1.
 *
 * Miss it and the user filters to "urgent", stays on page 4, and sees an empty
 * list - a bug that looks like "no results" and is really pagination. With
 * five separate useState calls, EVERY handler must remember `setPage(1)`, and
 * the fifth one written six months later will not.
 *
 * A reducer makes the invariant STRUCTURAL: page is reset in one place, in the
 * reducer, and no action can bypass it. The rule cannot be forgotten because
 * there is nowhere to forget it.
 *
 * -----------------------------------------------------------------------------
 * useState                              useReducer
 * -----------------------------------------------------------------------------
 * independent values                    values that change together
 * simple updates                        transitions with invariants
 * logic lives in handlers               logic lives in one pure function
 * hard to unit test (needs a component) reducer is a pure function - trivial
 * -----------------------------------------------------------------------------
 *
 * ANGULAR BRIDGE: this is NgRx without the store - the same action/reducer
 * shape, scoped to one component instead of the application. If you have used
 * NgRx, you already know this pattern; what is new is that it is LOCAL, needs
 * no module registration, and costs one import.
 *
 * It is also exactly what Redux Toolkit's `createSlice` generates (Phase 18),
 * so understanding this makes RTK feel like a shortcut rather than magic.
 * =============================================================================
 */

export interface TaskFiltersState {
  search: string;
  status: TaskStatus | 'all';
  priority: TaskPriority | 'all';
  page: number;
  limit: number;
}

/**
 * A DISCRIMINATED UNION of actions, keyed on `type`.
 *
 * This is where TypeScript pays for itself in a reducer. Inside the `switch`,
 * narrowing on `action.type` gives the exact payload for that case -
 * `action.value` is `TaskStatus | 'all'` in SET_STATUS and does not exist at
 * all in RESET. A single `{ type: string; payload?: unknown }` action type
 * would compile and then hand you `unknown` in every branch.
 */
export type TaskFiltersAction =
  | { type: 'SET_SEARCH'; value: string }
  | { type: 'SET_STATUS'; value: TaskStatus | 'all' }
  | { type: 'SET_PRIORITY'; value: TaskPriority | 'all' }
  | { type: 'SET_PAGE'; value: number }
  | { type: 'RESET' };

export const INITIAL_TASK_FILTERS: TaskFiltersState = {
  search: '',
  status: 'all',
  priority: 'all',
  page: 1,
  limit: 20,
};

/**
 * THE REDUCER - a PURE function: (state, action) => newState.
 *
 * Pure means no fetching, no localStorage, no Date.now(), no mutation of
 * `state`. Given the same inputs it must return the same output, every time.
 *
 * WHY PURITY IS NOT PEDANTRY HERE:
 *   - StrictMode double-invokes reducers in development to catch impurity. An
 *     impure reducer produces different results on the two calls and the bug
 *     surfaces as a value that is mysteriously doubled or skipped.
 *   - It is trivially unit-testable. No component, no render, no mocks - call
 *     it with a state and an action and assert on the result. That is why the
 *     test file for this has no `render()` in it at all.
 *
 * EXPORTED, deliberately, so it can be tested directly.
 */
export function taskFiltersReducer(
  state: TaskFiltersState,
  action: TaskFiltersAction,
): TaskFiltersState {
  switch (action.type) {
    /**
     * THE INVARIANT, IN ONE PLACE. Every filter change resets to page 1.
     *
     * Note each case returns a NEW OBJECT via spread. Mutating `state.page = 1`
     * and returning `state` would hand React the same reference and no
     * re-render would happen - the same reference trap as Phase 2, and the
     * reason Redux Toolkit bundles Immer to make this less tedious at depth.
     */
    case 'SET_SEARCH':
      return { ...state, search: action.value, page: 1 };

    case 'SET_STATUS':
      return { ...state, status: action.value, page: 1 };

    case 'SET_PRIORITY':
      return { ...state, priority: action.value, page: 1 };

    // Paging is the ONE action that does not reset the page - it IS the page.
    case 'SET_PAGE':
      return { ...state, page: action.value };

    case 'RESET':
      return INITIAL_TASK_FILTERS;

    default: {
      /**
       * EXHAUSTIVENESS CHECKING - the most useful five lines in any reducer.
       *
       * If every case is handled, TypeScript narrows `action` to `never` here,
       * and `never` is assignable to `never`, so this compiles. Add a sixth
       * action to the union and forget its case, and `action` is that action
       * type - NOT assignable to `never` - so THIS LINE becomes a compile
       * error.
       *
       * The alternative - `default: return state` - silently ignores unknown
       * actions. The dispatch appears to do nothing, there is no error, and
       * you debug the component for an hour before finding the missing case.
       *
       * INTERVIEW: "how do you make sure a switch handles every case?" -
       * assign the discriminant to `never` in the default branch.
       */
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/**
 * Maps UI filter state onto the API query the backend actually accepts.
 *
 * WHY A SEPARATE FUNCTION, AND WHY IT MATTERS ARCHITECTURALLY:
 *
 * The UI uses the sentinel `'all'` because a `<select>` needs a concrete value
 * for "no filter" - an empty option value is fiddly and `undefined` cannot be
 * a select value. The API has no such concept: it expects the parameter to be
 * ABSENT.
 *
 * Sending `?status=all` would fail the backend's `@IsEnum(TaskStatus)`
 * validation with a 400, because 'all' is not a task status.
 *
 * This function is the ADAPTER between the two models. Keeping it separate
 * means the UI is free to invent whatever representation is convenient without
 * that leaking into the wire format - and when the API changes, exactly one
 * function changes.
 *
 * INTERVIEW: "how do you handle the mismatch between UI state and API
 * parameters?" - an explicit mapping layer, not by contorting one to fit the
 * other. The alternative (using `undefined` in UI state) makes the select
 * awkward; the alternative (accepting 'all' server-side) pollutes the API for
 * every client.
 */
export function toListTasksQuery(state: TaskFiltersState): ListTasksQuery {
  return {
    page: state.page,
    limit: state.limit,
    // Trimmed, and omitted entirely when empty - `?search=` is a filter on the
    // empty string as far as the backend is concerned.
    ...(state.search.trim() ? { search: state.search.trim() } : {}),
    ...(state.status !== 'all' ? { status: state.status } : {}),
    ...(state.priority !== 'all' ? { priority: state.priority } : {}),
  };
}

/**
 * =============================================================================
 * THE HOOK THAT USED TO LIVE HERE HAS BEEN DELETED - and why is the point
 * =============================================================================
 * `useTaskFilters()` wrapped the reducer in `useReducer` and was the original
 * consumer of everything above. Phase 5 replaced it with `useUrlTaskFilters`,
 * which holds the same state in the QUERY STRING instead - so filters survive a
 * refresh, can be shared as a link, and respond to the Back button.
 *
 * Once that landed, the hook had no callers. It sat here for several phases
 * because deleting code feels riskier than leaving it, which is exactly
 * backwards: unused code still has to be read, still shows up in search
 * results, and still looks like the intended way to do things to whoever
 * arrives next.
 *
 * WHAT SURVIVED, AND WHY, because this is the useful half:
 *
 *   taskFiltersReducer     the Phase 3 useReducer lesson, and a genuinely pure
 *                          function with its own test - no React required
 *   toListTasksQuery       the UI-to-API adapter that strips the `'all'`
 *                          sentinels. Still used by `useUrlTaskFilters`
 *   INITIAL_TASK_FILTERS   the defaults, still used
 *
 * The STORAGE MECHANISM changed; the STATE SHAPE and the TRANSITION RULES did
 * not. That split is why the replacement was a small change rather than a
 * rewrite - and it is the argument for keeping reducers free of React in the
 * first place.
 * =============================================================================
 */
