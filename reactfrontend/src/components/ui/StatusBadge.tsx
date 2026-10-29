import { Chip, type ChipProps } from '@mui/material';
import { TaskStatus } from '@/types/api';

/**
 * =============================================================================
 * StatusBadge - a PRESENTATIONAL component
 * =============================================================================
 * It takes data in, returns markup. No fetching, no store, no routing, no
 * knowledge of where the status came from. That is what makes it reusable in a
 * table row, a card, a detail header and a Storybook story without change.
 *
 * ANGULAR BRIDGE: this is a dumb/presentational component with `@Input()`s and
 * `ChangeDetectionStrategy.OnPush`. The React equivalent of OnPush is
 * `React.memo` - and note it is NOT applied here. Phase 16 explains why
 * memoising a component this cheap usually costs more than it saves.
 * =============================================================================
 */

/**
 * THE LOOKUP TABLE PATTERN - a `Record` keyed by the union, instead of a
 * switch or a chain of ternaries.
 *
 * `Record<TaskStatus, ...>` is what makes this safe: TypeScript requires EVERY
 * member of the union to have an entry. Add `TaskStatus.BLOCKED` to the API
 * types and this object becomes a compile error until it is handled here.
 * A `switch` with a `default` case, by contrast, would silently render the new
 * status as "Unknown" forever, and nobody would notice for a release or two.
 *
 * This is the single most useful trick for keeping UI in sync with a backend
 * enum, and it generalises to icons, colours, sort orders and permissions.
 *
 * `satisfies` rather than `:` - the difference matters. A type ANNOTATION
 * (`const map: Record<...> = {...}`) would widen each `color` to the full
 * ChipProps['color'] union. `satisfies` CHECKS the object against the type
 * while preserving the narrower literal types of what we actually wrote, so
 * `STATUS_META[TaskStatus.DONE].color` is the literal `'success'`.
 *
 * INTERVIEW: "what does `satisfies` do that a type annotation does not?" -
 * it validates without widening.
 */
const STATUS_META = {
  [TaskStatus.TODO]: { label: 'To do', color: 'default' },
  [TaskStatus.IN_PROGRESS]: { label: 'In progress', color: 'info' },
  [TaskStatus.IN_REVIEW]: { label: 'In review', color: 'warning' },
  [TaskStatus.DONE]: { label: 'Done', color: 'success' },
} satisfies Record<TaskStatus, { label: string; color: ChipProps['color'] }>;

interface StatusBadgeProps {
  status: TaskStatus;
  /**
   * NOT `size: string`. Reusing MUI's own prop type means the two can never
   * disagree, and the editor autocompletes the real options.
   *
   * The wider principle for props: type them as NARROWLY as the domain allows.
   * `status: string` would compile with `"banana"`; `status: TaskStatus` will
   * not. Every widened prop type is a runtime check you have volunteered to
   * write by hand later.
   */
  size?: ChipProps['size'];
}

export function StatusBadge({ status, size = 'small' }: StatusBadgeProps) {
  const meta = STATUS_META[status];

  return (
    <Chip
      label={meta.label}
      color={meta.color}
      size={size}
      variant="outlined"
      /**
       * COLOUR IS NEVER THE ONLY SIGNAL. The label carries the meaning, and
       * the colour reinforces it. Roughly 1 in 12 men has some form of colour
       * vision deficiency, so a status conveyed by hue alone is invisible to
       * them - and to anyone on a bad monitor in sunlight.
       *
       * This is WCAG 1.4.1 (Use of Colour), and it is the accessibility rule
       * most often broken by exactly this kind of component.
       */
      aria-label={`Status: ${meta.label}`}
    />
  );
}
