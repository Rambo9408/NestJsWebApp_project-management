import { Chip, type ChipProps } from '@mui/material';
import { TaskPriority } from '@/types/api';

/**
 * PriorityBadge - the same shape as StatusBadge, deliberately NOT merged with
 * it into one generic `<Badge kind="status" | "priority">`.
 *
 * WHY NOT MERGE - this is a real API-design decision, not laziness:
 *
 *   A merged component would need `kind` to select the lookup table, and its
 *   `value` prop would have to be `TaskStatus | TaskPriority`. Nothing would
 *   then stop `<Badge kind="status" value={TaskPriority.URGENT} />` from
 *   compiling. Recovering the safety needs a discriminated union of props and
 *   generics - real complexity, to save about fifteen lines of markup.
 *
 *   Two small components that are each obviously correct beat one clever
 *   component that needs a paragraph of types to be correct.
 *
 * THE RULE OF THREE: wait until you have three near-identical implementations
 * before abstracting. Two similar things are usually a coincidence; three is a
 * pattern. Premature abstraction is harder to unwind than duplication, because
 * duplication is visible and a bad abstraction is load-bearing.
 *
 * INTERVIEW: "when do you extract a shared component?" - the honest answer is
 * about the RATE OF CHANGE, not line count. Extract when the two copies must
 * change together. Keep them apart when they merely look alike today.
 */

const PRIORITY_META = {
  [TaskPriority.LOW]: { label: 'Low', color: 'default' },
  [TaskPriority.MEDIUM]: { label: 'Medium', color: 'info' },
  [TaskPriority.HIGH]: { label: 'High', color: 'warning' },
  [TaskPriority.URGENT]: { label: 'Urgent', color: 'error' },
} satisfies Record<TaskPriority, { label: string; color: ChipProps['color'] }>;

interface PriorityBadgeProps {
  priority: TaskPriority;
  size?: ChipProps['size'];
}

export function PriorityBadge({ priority, size = 'small' }: PriorityBadgeProps) {
  const meta = PRIORITY_META[priority];

  return (
    <Chip
      label={meta.label}
      color={meta.color}
      size={size}
      // `filled` here vs `outlined` on StatusBadge: priority is the more urgent
      // signal, so it gets the heavier visual weight. Two badges with identical
      // treatment would compete for attention and neither would win.
      variant="filled"
      aria-label={`Priority: ${meta.label}`}
    />
  );
}
