import { describe, expect, it } from 'vitest';
import {
  INITIAL_TASK_FILTERS,
  taskFiltersReducer,
  toListTasksQuery,
  type TaskFiltersState,
} from './useTaskFilters';
import { TaskPriority, TaskStatus } from '@/types/api';

/**
 * =============================================================================
 * TESTING A REDUCER - and why this file has no `render()` in it
 * =============================================================================
 * A reducer is a PURE FUNCTION. Call it with a state and an action, assert on
 * the result. No component, no DOM, no async, no mocks. These tests run in
 * microseconds and cannot flake.
 *
 * THIS IS THE STRONGEST ARGUMENT FOR useReducer over scattered useState:
 * `setPage(1)` inside five different event handlers can only be tested by
 * rendering a component and clicking things. The same logic in a reducer is
 * testable as arithmetic.
 *
 * INTERVIEW: "how do you test complex state logic?" - extract it into a pure
 * reducer and test the function. If your state logic is hard to test, that is
 * usually a message about where it lives, not about testing.
 * =============================================================================
 */
describe('taskFiltersReducer', () => {
  /**
   * THE INVARIANT. This is the whole reason the reducer exists, so it gets a
   * test per filter rather than one representative case - the bug this guards
   * against is precisely "someone added a fourth filter and forgot the reset".
   */
  describe('resets to page 1 whenever a filter changes', () => {
    const onPageFour: TaskFiltersState = { ...INITIAL_TASK_FILTERS, page: 4 };

    it.each([
      [{ type: 'SET_SEARCH', value: 'auth' } as const],
      [{ type: 'SET_STATUS', value: TaskStatus.DONE } as const],
      [{ type: 'SET_PRIORITY', value: TaskPriority.URGENT } as const],
    ])('$type', (action) => {
      expect(taskFiltersReducer(onPageFour, action).page).toBe(1);
    });
  });

  it('does NOT reset the page when the page itself changes', () => {
    // The one exception, and it needs its own test - a reducer that reset on
    // SET_PAGE would make pagination impossible while every other test passed.
    const result = taskFiltersReducer(INITIAL_TASK_FILTERS, { type: 'SET_PAGE', value: 3 });

    expect(result.page).toBe(3);
  });

  it('does not mutate the state it was given', () => {
    /**
     * PURITY, ASSERTED. If the reducer mutated, React would receive the same
     * reference and skip the re-render - the Phase 2 bug, in a new location.
     *
     * Checking BOTH that the input is unchanged AND that the output is a new
     * reference. Either alone would miss a real failure mode.
     */
    const state: TaskFiltersState = { ...INITIAL_TASK_FILTERS, page: 4 };
    const result = taskFiltersReducer(state, { type: 'SET_SEARCH', value: 'auth' });

    expect(state.page).toBe(4);
    expect(state.search).toBe('');
    expect(result).not.toBe(state);
  });

  it('RESET returns the initial filters', () => {
    const dirty: TaskFiltersState = {
      search: 'auth',
      status: TaskStatus.DONE,
      priority: TaskPriority.HIGH,
      page: 7,
      limit: 50,
    };

    expect(taskFiltersReducer(dirty, { type: 'RESET' })).toEqual(INITIAL_TASK_FILTERS);
  });
});

/**
 * The adapter gets its own describe block because it encodes a contract with
 * the BACKEND, not with the UI. These assertions are what stop us sending
 * `?status=all` and getting a 400 from `@IsEnum(TaskStatus)`.
 */
describe('toListTasksQuery', () => {
  it('omits filters set to "all" rather than sending the sentinel', () => {
    const query = toListTasksQuery(INITIAL_TASK_FILTERS);

    // `not.toHaveProperty`, not `toBeUndefined`. The key must be ABSENT, since
    // the query-string builder would serialise a present-but-undefined value.
    expect(query).not.toHaveProperty('status');
    expect(query).not.toHaveProperty('priority');
    expect(query).not.toHaveProperty('search');
  });

  it('includes filters that are actually set', () => {
    const query = toListTasksQuery({
      ...INITIAL_TASK_FILTERS,
      status: TaskStatus.IN_REVIEW,
      priority: TaskPriority.URGENT,
    });

    expect(query.status).toBe('in_review');
    expect(query.priority).toBe('urgent');
  });

  it('trims search, and omits it when it is only whitespace', () => {
    expect(toListTasksQuery({ ...INITIAL_TASK_FILTERS, search: '  auth  ' }).search).toBe('auth');
    expect(toListTasksQuery({ ...INITIAL_TASK_FILTERS, search: '   ' })).not.toHaveProperty(
      'search',
    );
  });

  it('always sends pagination', () => {
    const query = toListTasksQuery({ ...INITIAL_TASK_FILTERS, page: 3, limit: 50 });

    expect(query).toMatchObject({ page: 3, limit: 50 });
  });
});
