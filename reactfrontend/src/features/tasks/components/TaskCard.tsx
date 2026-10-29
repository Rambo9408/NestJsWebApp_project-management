import { Box, ButtonBase, Card, CardContent, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { Task } from '@/types/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriorityBadge } from '@/components/ui/PriorityBadge';

/**
 * =============================================================================
 * TaskCard - the props/composition showcase
 * =============================================================================
 * PRESENTATIONAL. It receives a Task and renders it. It does not fetch, does
 * not dispatch, does not know about the store or the router.
 *
 * WHY THAT SEPARATION EARNS ITS KEEP - four concrete pay-offs, not a principle:
 *   1. It renders identically in a list, a search result and a detail page.
 *   2. Its tests need no store, no router and no network - pass a Task, assert
 *      on the output.
 *   3. It can be rendered in every state (overdue, unassigned, urgent) without
 *      contriving backend data to produce them.
 *   4. When the data layer changes - and in this project it changes twice, at
 *      Phase 9 and again for optimistic updates - this file does not.
 *
 * ANGULAR BRIDGE: a dumb component with `@Input()`s. Where `@Output()`
 * EventEmitters would go, React passes plain callback props. Genuinely simpler:
 * no EventEmitter, no subscription, no `.emit()` - a callback prop IS the
 * function, called directly.
 * =============================================================================
 */

interface TaskCardProps {
  /**
   * THE WHOLE OBJECT, not fifteen scalar props.
   *
   *   BAD:  <TaskCard title={t.title} status={t.status} priority={t.priority}
   *                  dueDate={t.dueDate} assigneeId={t.assigneeId} ... />
   *
   * That is the "prop explosion" anti-pattern. Every new field on the Task
   * model means editing this component AND every call site. The props are also
   * unrelated to each other in the type system, so nothing stops a caller
   * passing one task's title with another's status.
   *
   * THE COUNTER-ARGUMENT, which is real: passing the whole object couples this
   * component to the shape of `Task`. If it only needed a title and a status,
   * `Pick<Task, 'title' | 'status'>` would keep it usable for anything with
   * those two fields.
   *
   * We pass the whole Task because this component is ABOUT a task - the
   * coupling already exists and pretending otherwise is ceremony. A generic
   * `<Card>` would be the opposite call.
   */
  task: Task;

  /**
   * A DISPLAY NAME RESOLVED BY THE PARENT.
   *
   * The API gives us `assigneeId`, not a name. The tempting fix is for this
   * component to fetch the user itself - and that is the N+1 QUERY PATTERN
   * arriving in your UI: fifty task cards fire fifty user requests, the list
   * takes four seconds, and the cause is invisible because it is spread across
   * fifty components.
   *
   * Resolving it in the parent - which already has the user list, or asks for
   * tasks-with-assignees in one call - turns 50 requests into 1. The backend
   * anticipated this: `GET /tasks` returns `Paginated<TaskWithAssignee>`.
   *
   * `null` MEANS UNASSIGNED and is a real, renderable state - not a missing
   * value. That is why the prop is `string | null` and not optional.
   *
   * INTERVIEW: "a list page fires one request per row - how do you fix it?"
   * Lift the data requirement to the list, and have the API return what the
   * list needs in one response.
   */
  assigneeName: string | null;

  /**
   * A SLOT for row actions - the same inversion of control as EmptyState.
   *
   * A list view wants an overflow menu, a board wants nothing, a detail page
   * wants three buttons. A `ReactNode` serves all three; `onEdit`/`onDelete`
   * callback props would serve one and then grow forever.
   */
  actions?: ReactNode;

  /**
   * OPTIONAL, and that is what makes the card usable in a read-only context.
   *
   * If this were required, every caller would have to pass a no-op. Optional
   * callbacks let the component decide to render a non-interactive variant -
   * see the `interactive` logic below, which is why the whole card is not
   * always a button.
   */
  onSelect?: (taskId: string) => void;
}

export function TaskCard({ task, assigneeName, actions, onSelect }: TaskCardProps) {
  /**
   * DERIVED STATE, COMPUTED DURING RENDER. Not `useState` + `useEffect`.
   *
   * `isOverdue` is a pure function of props. Storing it in state would create
   * a second source of truth that has to be kept in sync - and the sync is
   * always one render late, so the card would briefly show a stale badge after
   * the due date changed.
   *
   * THE RULE: if you can calculate it from props and state, calculate it.
   * State is for what you cannot derive. This is the single most common
   * unnecessary-useEffect in React codebases, and Phase 11 has the full
   * treatment.
   *
   * The `!== TaskStatus.DONE` clause is domain logic, not decoration: a task
   * finished after its due date is complete, not overdue, and showing it as
   * late would be actively wrong.
   */
  const isOverdue =
    task.dueDate !== null && new Date(task.dueDate) < new Date() && task.status !== 'done';

  const interactive = Boolean(onSelect);

  return (
    <Card
      variant="outlined"
      sx={{
        // `relative` is what the overlay button below positions against.
        position: 'relative',
        borderColor: isOverdue ? 'error.main' : undefined,
        '&:hover': interactive ? { borderColor: 'primary.main' } : undefined,
        // The overlay is the real focus target, but it is invisible - so the
        // ring has to be drawn on the CARD, or keyboard users get no visible
        // focus indicator at all. WCAG 2.4.7. `:focus-within` is what makes
        // this pattern usable rather than merely valid.
        '&:focus-within': interactive
          ? { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 }
          : undefined,
      }}
    >
      {/*
        =======================================================================
        THE OVERLAY BUTTON - and why the previous version of this was wrong
        =======================================================================
        THIS FILE USED TO PUT `role="button"` + `tabIndex={0}` + a hand-rolled
        `onKeyDown` ON THE CARD BODY, with a long comment explaining that a real
        <button> was impossible because the `actions` slot may contain buttons
        and nesting them would be invalid.

        The comment called that "a genuine design tension, not a shortcut".
        axe called it `nested-interactive`, SERIOUS - because the tension was
        real but the conclusion was wrong. There is a third option.

        WHY NESTED INTERACTIVE ELEMENTS ARE AN ACTUAL FAILURE, not pedantry:
        screen readers in browse mode present a control as a single unit. A
        button inside a button has no reachable inner control - the overflow
        menu in `actions` becomes ANNOUNCED BUT UNREACHABLE. The keyboard
        behaviour is worse: Enter on the outer element fires the outer handler,
        so the user can never open the menu. The feature is simply gone for
        them, and it still works perfectly with a mouse - which is why nobody
        notices.

        THE FIX - the "stretched link" / overlay pattern:
        an absolutely positioned, transparent <ButtonBase> that covers the card
        and is a SIBLING of the content rather than an ancestor of it. So:

          - it is a real <button>: Tab, Enter, Space, focus ring, and the
            correct role all come from the browser. The hand-rolled onKeyDown
            is deleted, and with it the bug where someone eventually handles
            Enter and forgets Space.
          - `actions` is no longer a descendant of it, so nothing is nested and
            the overflow menu is reachable again.
          - the accessible name is explicit, because the button has no text of
            its own.

        WHAT IT COSTS, because this pattern is not free:
          1. TEXT SELECTION. The overlay sits above the content, so the user
             cannot select the description with the mouse. Real, and the usual
             reason to reject this pattern on text-heavy cards.
          2. Anything else interactive in the card needs to be lifted above the
             overlay explicitly (see `zIndex` on the actions slot).
          3. Right-click/middle-click "open in new tab" does not work - which is
             why a card that NAVIGATES should use a real <a href> here instead
             of a button. This one calls a handler, so a button is correct.

        INTERVIEW - "how do you make a whole card clickable?" A strong answer
        names all three options and picks between them: (a) `onClick` on a div,
        which is broken; (b) hand-rolled ARIA, which is valid until the card
        contains its own controls; (c) the overlay, which is what you use when
        it does. The follow-up is "what does it cost?" - and text selection is
        the answer they are listening for.
        =======================================================================
      */}
      {interactive && (
        <ButtonBase
          onClick={() => {
            onSelect?.(task.id);
          }}
          // The button is empty, so without this it announces as just "button".
          // The reference is included because it is how humans refer to a task.
          aria-label={`${task.reference}: ${task.title}`}
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            borderRadius: 'inherit',
            // The card draws the focus ring via :focus-within, so suppress the
            // default one here rather than drawing two.
            '&.Mui-focusVisible': { outline: 'none' },
          }}
        />
      )}
      <CardContent sx={{ cursor: interactive ? 'pointer' : 'default' }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="subtitle1" component="h3" sx={{ flexGrow: 1, fontWeight: 600 }}>
              {/*
                THE REFERENCE ("PH-3") LEADS THE TITLE.

                It exists so humans can talk about a task out loud - in standup,
                in a commit message, in a Slack thread. A Mongo ObjectId cannot
                do that job; nobody says "let's discuss 6a86c20db6c2751f842612a2".

                This field was MISSING from our Task type until Phase 7, found
                by printing the keys of a real response. Worth noticing that a
                hand-written response type does not merely risk being wrong - it
                risks making a genuinely useful field INVISIBLE to the whole
                frontend, silently, with no error anywhere.
              */}
              <Typography component="span" color="text.secondary" sx={{ mr: 1, fontWeight: 400 }}>
                {task.reference}
              </Typography>
              {task.title}
            </Typography>
            {/*
              The actions slot. The parent decides what goes here.

              `zIndex: 2` LIFTS IT ABOVE THE OVERLAY BUTTON, and this is load-
              bearing: without it the overlay covers the actions and every click
              on the overflow menu selects the card instead. The menu would be
              perfectly visible and completely dead - the exact failure mode the
              overlay was introduced to remove, reintroduced by z-ordering.

              `position: relative` is required for `zIndex` to apply at all; on
              a `static` element it is ignored silently. Two properties that
              only work together, which is why they are one style object and not
              separated.
            */}
            <Box sx={{ position: 'relative', zIndex: 2 }}>{actions}</Box>
          </Stack>

          {/*
            OPTIONAL vs NULLABLE, and the project is consistent about it:
              description?: string    - the field may be ABSENT
              assigneeId: string|null - the field is PRESENT and empty

            They read the same in JSX and mean different things in the domain.
            `null` is a deliberate "no assignee"; `undefined` is "no
            description was ever written".
          */}
          {task.description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                // Truncate to two lines. Without a clamp, one task with a long
                // description makes its card four times taller than its
                // neighbours and destroys the rhythm of the list.
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {task.description}
            </Typography>
          )}

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />

            <Box sx={{ flexGrow: 1 }} />

            {/*
              A TERNARY, not `&&`, because BOTH branches render something.
              "Unassigned" is information the user needs - an empty space would
              leave them unsure whether the field is empty or still loading.
            */}
            <Typography variant="caption" color={assigneeName ? 'text.secondary' : 'text.disabled'}>
              {assigneeName ?? 'Unassigned'}
            </Typography>
          </Stack>

          {task.dueDate && (
            <Typography variant="caption" color={isOverdue ? 'error.main' : 'text.secondary'}>
              {/*
                `Intl.DateTimeFormat` via toLocaleDateString - built in, zero
                bundle cost, and it respects the user's locale. Reaching for
                date-fns or dayjs to format a date is a dependency you usually
                do not need. (Date MATH across time zones is the case where a
                library genuinely earns its place.)

                `undefined` as the locale means "use the browser's". Hardcoding
                'en-US' would show 3/4/2026 to a European user who reads it as
                4 March.
              */}
              Due {new Date(task.dueDate).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
              {isOverdue && ' - overdue'}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
