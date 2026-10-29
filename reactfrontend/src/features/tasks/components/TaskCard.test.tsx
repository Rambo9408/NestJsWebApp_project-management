import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskCard } from './TaskCard';
import { type Task, TaskPriority, TaskStatus } from '@/types/api';

/**
 * =============================================================================
 * TESTING A PRESENTATIONAL COMPONENT
 * =============================================================================
 * Notice what this file does NOT need: no store, no router, no MSW, no network,
 * no async. That is the dividend of keeping the component presentational - the
 * tests are fast, deterministic, and they read like a specification.
 *
 * A FACTORY WITH OVERRIDES rather than a shared mutable fixture. Each test
 * states only the field it cares about, so the intent is visible in the test
 * body instead of hidden in a setup block twenty lines up. It also means no
 * test can corrupt another's data - a real source of order-dependent failures.
 *
 * `Partial<Task>` is the utility type doing the work here: every field
 * optional, so a caller overrides one and inherits the rest.
 * =============================================================================
 */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    reference: 'PH-1',
    createdById: 'user-9',
    title: 'Write the API contract types',
    description: 'Transcribe from the NestJS controllers.',
    projectId: 'project-1',
    assigneeId: 'user-1',
    status: TaskStatus.TODO,
    priority: TaskPriority.MEDIUM,
    dueDate: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TaskCard', () => {
  it('renders the task title as a heading', () => {
    render(<TaskCard task={makeTask()} assigneeName="Ada Lovelace" />);

    // Queried BY ROLE, not by text or class. This asserts two things at once:
    // the text is present, AND it is marked up as a heading - which is what a
    // screen-reader user relies on to navigate a list of cards.
    expect(screen.getByRole('heading', { name: /write the api contract types/i })).toBeVisible();
  });

  it('shows "Unassigned" when assigneeName is null', () => {
    render(<TaskCard task={makeTask({ assigneeId: null })} assigneeName={null} />);

    // The empty case is REAL CONTENT, not an absence. Asserting on it stops a
    // future refactor from silently rendering a blank gap.
    expect(screen.getByText('Unassigned')).toBeVisible();
  });

  it('marks a past-due, unfinished task as overdue', () => {
    render(
      <TaskCard
        task={makeTask({ dueDate: '2020-01-01T00:00:00.000Z', status: TaskStatus.TODO })}
        assigneeName="Ada"
      />,
    );

    expect(screen.getByText(/overdue/i)).toBeVisible();
  });

  it('does NOT mark a completed task as overdue, even if it finished late', () => {
    /**
     * THE MOST VALUABLE TEST IN THIS FILE.
     *
     * It pins DOMAIN LOGIC, not markup: a task finished after its due date is
     * complete, not late. That rule lives in one boolean expression inside the
     * component and would be trivially easy to "simplify" away in a future
     * refactor. This test is what makes that a failing build instead of a
     * confusing red badge in production.
     *
     * Tests that assert a heading renders are cheap insurance. Tests that pin
     * a business rule are the ones that pay for themselves.
     */
    render(
      <TaskCard
        task={makeTask({ dueDate: '2020-01-01T00:00:00.000Z', status: TaskStatus.DONE })}
        assigneeName="Ada"
      />,
    );

    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });

  it('renders whatever node is passed to the actions slot', () => {
    render(
      <TaskCard
        task={makeTask()}
        assigneeName="Ada"
        actions={<button type="button">Archive</button>}
      />,
    );

    // Proves the inversion of control actually works: the card imposes no
    // shape on its actions.
    expect(screen.getByRole('button', { name: 'Archive' })).toBeVisible();
  });

  describe('interactivity', () => {
    it('is not a button when onSelect is omitted', () => {
      render(<TaskCard task={makeTask()} assigneeName="Ada" />);

      // A tab stop that does nothing is worse than no tab stop - the user
      // lands somewhere, presses Enter, and nothing happens.
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('calls onSelect with the task id when clicked', async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<TaskCard task={makeTask({ id: 'task-42' })} assigneeName="Ada" onSelect={onSelect} />);
      await user.click(screen.getByRole('button'));

      // Asserting the ARGUMENT, not just that it was called. A handler that
      // fires with the wrong id is a bug that "toHaveBeenCalled" cannot see.
      expect(onSelect).toHaveBeenCalledWith('task-42');
    });

    it('activates on both Enter and Space for keyboard users', async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<TaskCard task={makeTask({ id: 'task-42' })} assigneeName="Ada" onSelect={onSelect} />);

      /**
       * `user.tab()` proves the card is genuinely REACHABLE by keyboard - a
       * click test would pass even on an element with no tabIndex, hiding the
       * fact that keyboard users cannot get to it at all.
       *
       * Both keys are checked because native buttons respond to both, and a
       * hand-rolled `role="button"` that handles only Enter is the standard
       * half-finished implementation.
       *
       * THIS TEST NOW PASSES FOR A BETTER REASON THAN IT USED TO. The card
       * originally hand-rolled `role="button"` + `tabIndex` + `onKeyDown`, and
       * this test verified that hand-rolled code. After the accessibility pass
       * replaced it with a real <button> overlay, the SAME assertions verify
       * BROWSER behaviour instead - which is why the test did not need editing.
       *
       * That is the mark of a test written against behaviour rather than
       * implementation: the implementation was replaced wholesale and the test
       * kept its meaning.
       */
      await user.tab();
      expect(screen.getByRole('button')).toHaveFocus();

      await user.keyboard('{Enter}');
      await user.keyboard(' ');

      expect(onSelect).toHaveBeenCalledTimes(2);
    });

    /**
     * =======================================================================
     * THE REGRESSION TEST FOR THE OVERLAY PATTERN
     * =======================================================================
     * The overlay button covers the entire card. That is the point of it - and
     * it is also how the pattern fails: anything else interactive in the card
     * ends up UNDERNEATH the overlay, visible and completely dead. Clicking the
     * overflow menu selects the card instead.
     *
     * The card guards against this with `position: relative; zIndex: 2` on the
     * actions slot.
     *
     * -----------------------------------------------------------------------
     * READ THIS BEFORE TRUSTING THIS TEST: IT DOES NOT COVER THE Z-INDEX
     * -----------------------------------------------------------------------
     * The first version of this comment claimed "verified load-bearing:
     * removing `zIndex: 2` makes this fail". That was written as an assumption
     * and then checked - and it was FALSE. With the z-index deleted, this test
     * still passes.
     *
     * WHY: jsdom implements no layout and no hit-testing. Every element has
     * zero size at position 0,0 and there is no such thing as "on top". So
     * `user.click(archiveButton)` dispatches the event directly on that
     * element, whatever visually covers it. The DOM does not know the overlay
     * is in the way, because in jsdom it is not in the way - it has no way.
     *
     * SO THIS TEST COVERS THE WIRING, NOT THE STACKING: it proves the actions
     * slot has its own handler and that the handler is not also firing the
     * card's. A real regression - `onClick` on the overlay bubbling into the
     * action, or the action's handler being dropped - is caught here. Someone
     * deleting the `zIndex` is NOT.
     *
     * THE REAL GUARD is a browser test. Playwright's `click()` performs an
     * actionability check that includes "does this element actually receive
     * the event at these coordinates", which fails on an obscured element -
     * which is precisely the check jsdom cannot make. It is in ROADMAP.md.
     *
     * -----------------------------------------------------------------------
     * The wider point, which is worth more than the test
     * -----------------------------------------------------------------------
     * A jsdom test suite has a SHAPE of blindness, not just gaps: anything
     * decided by layout is invisible to it. z-order, overflow clipping, an
     * element scrolled out of view, a `position: fixed` header covering a
     * control, a zero-height container - all render "fine" and all pass.
     *
     * Knowing which of your tests cannot fail is a real skill, and asserting
     * "load-bearing" without reintroducing the bug is how vacuous tests get
     * written. That claim above was wrong for about four minutes because it was
     * plausible. Checking is cheap; assuming is what produces a green suite
     * that proves nothing.
     *
     * VERIFIED, honestly: restoring `role="button"` to the card body - the
     * ORIGINAL bug - fails four tests, including this one and the axe check.
     * Deleting the `zIndex` fails none.
     * =======================================================================
     */
    it('lets clicks reach the actions slot instead of the card overlay', async () => {
      const onSelect = vi.fn();
      const onArchive = vi.fn();
      const user = userEvent.setup();

      render(
        <TaskCard
          task={makeTask({ id: 'task-42' })}
          assigneeName="Ada"
          onSelect={onSelect}
          actions={
            <button type="button" onClick={onArchive}>
              Archive
            </button>
          }
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Archive' }));

      expect(onArchive).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });

    /**
     * The failure the overlay pattern exists to prevent, asserted directly.
     *
     * When the card body itself carried `role="button"`, the actions slot was a
     * DESCENDANT of a button. Screen readers present a control as one unit, so
     * the inner button was announced but unreachable - and axe called it
     * `nested-interactive`, serious.
     *
     * Two independent buttons, neither containing the other, is the structural
     * property that fixes it. `closest('button')` is deliberately crude: it
     * asks the DOM question the accessibility tree actually cares about.
     */
    it('does not nest the actions inside the card button', () => {
      render(
        <TaskCard
          task={makeTask()}
          assigneeName="Ada"
          onSelect={vi.fn()}
          actions={<button type="button">Archive</button>}
        />,
      );

      const archive = screen.getByRole('button', { name: 'Archive' });

      expect(archive.parentElement?.closest('button')).toBeNull();
      expect(screen.getAllByRole('button')).toHaveLength(2);
    });
  });
});
