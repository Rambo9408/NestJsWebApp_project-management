import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { TaskPriority, TaskStatus } from '@/types/api';

/**
 * TABLE-DRIVEN TESTS via `it.each`.
 *
 * The alternative is four near-identical `it` blocks. The table makes the
 * mapping itself the specification - you can read the expected labels in one
 * glance - and adding a fifth status is one new row rather than one new block.
 *
 * A REAL LIMIT WORTH NAMING: this proves each status renders its label, but it
 * cannot prove the table is EXHAUSTIVE - forget a row and the test still
 * passes. Exhaustiveness is enforced by `Record<TaskStatus, ...>` in the
 * component instead, at compile time.
 *
 * That division is the useful lesson: let the type system prove what it can
 * prove, and spend tests on what it cannot.
 */
describe('StatusBadge', () => {
  it.each([
    [TaskStatus.TODO, 'To do'],
    [TaskStatus.IN_PROGRESS, 'In progress'],
    [TaskStatus.IN_REVIEW, 'In review'],
    [TaskStatus.DONE, 'Done'],
  ])('renders %s as "%s"', (status, label) => {
    render(<StatusBadge status={status} />);

    expect(screen.getByText(label)).toBeVisible();
  });

  it('conveys status by text, not colour alone', () => {
    render(<StatusBadge status={TaskStatus.DONE} />);

    /**
     * WCAG 1.4.1. Around 1 in 12 men has some colour vision deficiency, so a
     * badge distinguished only by hue is invisible to them.
     *
     * The accessible NAME is asserted rather than the visible text, because
     * that is what a screen reader actually announces - and "Status: Done" is
     * far more useful out of context than a bare "Done".
     */
    expect(screen.getByLabelText('Status: Done')).toBeVisible();
  });
});

describe('PriorityBadge', () => {
  it.each([
    [TaskPriority.LOW, 'Low'],
    [TaskPriority.MEDIUM, 'Medium'],
    [TaskPriority.HIGH, 'High'],
    [TaskPriority.URGENT, 'Urgent'],
  ])('renders %s as "%s"', (priority, label) => {
    render(<PriorityBadge priority={priority} />);

    expect(screen.getByText(label)).toBeVisible();
  });
});
