import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/**
 * =============================================================================
 * EmptyState - and a lesson in COMPONENT API DESIGN
 * =============================================================================
 * The empty state is the one every team forgets, and it is the FIRST thing a
 * new user sees. A brand-new account has no projects and no tasks, so the
 * "empty" screen is the actual onboarding experience. Rendering a blank div
 * there reads as a broken app.
 *
 * A GOOD empty state does three things:
 *   1. Says what would be here
 *   2. Says why it is not
 *   3. Offers the action that fixes it
 *
 * That third point is why `action` is a prop.
 * =============================================================================
 */

interface EmptyStateProps {
  title: string;
  description?: string;
  /**
   * `ReactNode`, NOT `{ label: string; onClick: () => void }`.
   *
   * THIS IS THE KEY API DECISION IN THIS FILE, so it is worth being explicit
   * about the alternative:
   *
   *   BAD - a configuration prop:
   *     action?: { label: string; onClick: () => void }
   *
   *   It looks tidier and it is a trap. The first caller wants a button. The
   *   second wants a link. The third wants a button with an icon; the fourth
   *   wants two buttons; the fifth wants one that is disabled with a tooltip.
   *   Each request adds a prop - `actionIcon`, `actionHref`,
   *   `actionDisabled`, `secondaryAction` - until the component has fifteen
   *   props and still cannot express what the sixth caller needs.
   *
   *   That growth pattern has a name: the CONFIGURATION TRAP. It happens
   *   whenever a component tries to DESCRIBE its children instead of
   *   ACCEPTING them.
   *
   *   GOOD - accept a node:
   *     action?: ReactNode
   *
   *   Now the caller passes whatever they want and the component never needs
   *   another prop. Inversion of control: EmptyState owns the layout, the
   *   caller owns the content.
   *
   * ANGULAR BRIDGE: `ReactNode` props are `<ng-content select="[action]">` -
   * content projection. The React version is more flexible because a node is
   * an ordinary JavaScript value: it can be stored in a variable, returned
   * from a function, or chosen with a ternary.
   *
   * INTERVIEW: "how do you design a reusable component API?" - prefer
   * composition (children/slots) over configuration (props describing what to
   * render). Reach for a config prop only when the shape is genuinely closed.
   */
  action?: ReactNode;
  /** An illustration or icon. Same slot reasoning as `action`. */
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <Stack
      spacing={2}
      sx={{ alignItems: 'center', textAlign: 'center', py: 6, px: 2 }}
      /**
       * `role="status"` so a screen reader announces the emptiness. Without
       * it, a user who filters a task list down to nothing hears silence and
       * cannot tell whether the app is still loading, broken, or genuinely
       * empty. Silence is the worst of the three, because it is ambiguous.
       */
      role="status"
    >
      {icon && <Box sx={{ color: 'text.disabled', fontSize: 48, lineHeight: 1 }}>{icon}</Box>}

      <Typography variant="h6" component="p">
        {title}
      </Typography>

      {/*
        CONDITIONAL RENDERING with `&&`.

        THE CLASSIC BUG this avoids: `{items.length && <List />}`. When the
        array is empty, `items.length` is `0` - a FALSY value that React still
        RENDERS, so a literal "0" appears on screen. `&&` only skips rendering
        for `false`, `null` and `undefined`; `0` and `NaN` are printed.

        The fix is to coerce to a real boolean: `{items.length > 0 && ...}`.
        Here `description` is a string, and the empty string is not rendered,
        so `&&` is safe - but the habit of writing an explicit comparison is
        worth keeping.

        ANGULAR BRIDGE: this is `*ngIf`. The difference is that JSX has no
        directive - it is just a JavaScript expression, which is why
        JavaScript's truthiness rules leak into your markup.
      */}
      {description && (
        <Typography color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      )}

      {action}
    </Stack>
  );
}
