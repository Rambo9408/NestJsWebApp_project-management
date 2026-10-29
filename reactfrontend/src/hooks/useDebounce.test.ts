import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebounce } from './useDebounce';
import { useDisclosure } from './useDisclosure';

/**
 * =============================================================================
 * TESTING CUSTOM HOOKS
 * =============================================================================
 * `renderHook` mounts a hook inside a throwaway component and hands back its
 * return value in `result.current`. It exists because the Rules of Hooks forbid
 * calling a hook outside a component - `useDebounce('a')` in a plain test would
 * throw.
 *
 * NOTE `result.current` IS RE-READ EVERY TIME, not destructured once:
 *
 *     const { isOpen } = result.current;   // WRONG - snapshot, never updates
 *     result.current.isOpen                // right - always the latest render
 *
 * That is the same closure-snapshot idea as Phase 2's counter bug, now showing
 * up in the test harness. Destructuring early is the number-one reason a
 * correct hook appears to fail its own test.
 * =============================================================================
 */
describe('useDebounce', () => {
  /**
   * FAKE TIMERS. Without them this suite would have to actually wait 300ms per
   * assertion - slow, and flaky on a loaded CI machine.
   *
   * `vi.advanceTimersByTime` moves the clock deterministically, so the test
   * asserts on the TIMING LOGIC rather than on real elapsed time. Testing
   * anything time-based with real timers is a false-failure generator.
   */
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Restoring matters: leaked fake timers make later suites hang in ways that
    // look unrelated to the test that caused them.
    vi.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 300));

    // No debounce on first render - the hook seeds state with the value. A hook
    // that returned undefined until the first delay elapsed would make every
    // consumer handle a bogus empty state.
    expect(result.current).toBe('initial');
  });

  it('does not update before the delay has elapsed', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(299);
    });

    // One millisecond short. Asserting the boundary rather than a comfortable
    // midpoint is what actually pins the behaviour.
    expect(result.current).toBe('a');
  });

  it('updates once the delay has elapsed', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'ab' });
    /**
     * `act()` wraps the timer advance because it causes a setState, and React
     * needs to flush that update before the assertion reads it. Without act,
     * the test would see the pre-update value and fail confusingly.
     */
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe('ab');
  });

  it('cancels the pending update when the value changes again', () => {
    /**
     * THE TEST THAT ACTUALLY PROVES THE HOOK WORKS.
     *
     * Everything above would still pass if the cleanup function were deleted -
     * the updates would simply all fire, late. This is the one that fails
     * without `clearTimeout`, because it simulates typing: three changes in
     * quick succession, only the last of which should ever be seen.
     *
     * If you write one test for a debounce hook, write this one.
     */
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ value: 'abc' });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ value: 'abcd' });
    // 200ms of pending timers have been superseded. Still the original value.
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Only the FINAL value lands - never the intermediate ones.
    expect(result.current).toBe('abcd');
  });
});

describe('useDisclosure', () => {
  it('starts closed by default and opens, closes and toggles', () => {
    const { result } = renderHook(() => useDisclosure());

    expect(result.current.isOpen).toBe(false);

    act(() => {
      result.current.open();
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('keeps stable callback identities across renders', () => {
    /**
     * PINNING THE useCallback CONTRACT.
     *
     * Consumers pass these to memoised children and effect dependency arrays.
     * If a future refactor drops the useCallback, every one of those consumers
     * silently starts re-rendering or re-running - a performance regression
     * with no visible symptom and no error.
     *
     * This test makes that regression a build failure. It is the kind of test
     * worth writing precisely because the bug it catches is invisible.
     */
    const { result, rerender } = renderHook(() => useDisclosure());
    const firstOpen = result.current.open;
    const firstToggle = result.current.toggle;

    rerender();

    expect(result.current.open).toBe(firstOpen);
    expect(result.current.toggle).toBe(firstToggle);
  });

  it('gives each caller its OWN independent state', () => {
    /**
     * THE ANGULAR-SERVICE DISTINCTION, asserted.
     *
     * An injected Angular service is a singleton by default: two components
     * share one instance. A custom hook shares LOGIC, never STATE - each call
     * gets its own. Getting this backwards is a common early misconception, and
     * it is why sharing state needs Context or a store.
     */
    const first = renderHook(() => useDisclosure());
    const second = renderHook(() => useDisclosure());

    act(() => {
      first.result.current.open();
    });

    expect(first.result.current.isOpen).toBe(true);
    expect(second.result.current.isOpen).toBe(false);
  });
});
