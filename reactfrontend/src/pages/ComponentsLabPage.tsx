import { useState } from 'react';
import { Box, Button, IconButton, Stack, Typography } from '@mui/material';
import { TaskCard } from '@/features/tasks/components/TaskCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { HttpError } from '@/services/httpClient';
import { type Task, TaskPriority, TaskStatus } from '@/types/api';

/**
 * =============================================================================
 * PHASE 2 - COMPONENT SHOWCASE
 * =============================================================================
 * Every component built this phase, rendered in every state it supports -
 * including the states that are hard to produce from real data (overdue,
 * unassigned, a 400 with three field errors).
 *
 * THIS IS A POOR MAN'S STORYBOOK, and the habit behind it is what matters.
 * Building a component against ONE happy-path example is how you ship a card
 * that breaks on a long title, a table that collapses when empty, and an error
 * panel nobody ever looked at. Rendering the edge cases beside each other makes
 * the gaps obvious in seconds.
 *
 * If this project grows, real Storybook replaces this file and adds visual
 * regression testing on top. The reasoning does not change.
 * =============================================================================
 */

/**
 * FIXTURES AT MODULE SCOPE, not inside the component.
 *
 * Defined inside, these objects would be rebuilt on every render with new
 * identities - which is exactly the kind of unstable reference that defeats
 * React.memo and makes "why does this re-render" investigations hard. They are
 * constants; treat them as constants.
 *
 * `satisfies Task` rather than `: Task` - it validates the shape against the
 * real API contract while keeping the literal types. Get a field wrong and it
 * is a compile error here, which is the point: these fixtures are only useful
 * if they cannot drift from the backend.
 */
const now = Date.now();
const DAY = 86_400_000;

const baseTask = {
  id: '6a869bf97c1f80d5b03c0001',
  projectId: '6a869bf97c1f80d5b03c0999',
  createdById: '6a869bf97c1f80d5b03c046a',
  createdAt: new Date(now - 5 * DAY).toISOString(),
  updatedAt: new Date(now - DAY).toISOString(),
} as const;

const TASKS = [
  {
    ...baseTask,
    id: `${baseTask.id}a`,
    reference: 'PH-1',
    title: 'Wire the RTK Query API slice to /api/v1/tasks',
    description:
      'Replace the hand-rolled fetch in ConnectivityPage with a generated hook. Should cover pagination, filtering and cache invalidation on mutation.',
    assigneeId: '6a869bf97c1f80d5b03c046a',
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    dueDate: new Date(now + 3 * DAY).toISOString(),
  },
  {
    ...baseTask,
    id: `${baseTask.id}b`,
    reference: 'PH-2',
    title: 'Unassigned and overdue - two edge cases in one card',
    description: undefined,
    assigneeId: null,
    status: TaskStatus.TODO,
    priority: TaskPriority.URGENT,
    dueDate: new Date(now - 2 * DAY).toISOString(),
  },
  {
    ...baseTask,
    id: `${baseTask.id}c`,
    reference: 'PH-3',
    title: 'Completed after its due date - late, but NOT overdue',
    assigneeId: '6a869bf97c1f80d5b03c046a',
    status: TaskStatus.DONE,
    priority: TaskPriority.LOW,
    dueDate: new Date(now - 10 * DAY).toISOString(),
  },
] satisfies Task[];

/** A real 400 from the backend - copied verbatim from a live response. */
const VALIDATION_ERROR = new HttpError(
  400,
  {
    success: false,
    statusCode: 400,
    message: [
      'email must be a valid email address',
      'name must be longer than or equal to 2 characters',
      'password must be at least 10 characters and contain lower case, upper case and a digit',
    ],
    error: 'BadRequestException',
    path: '/api/v1/auth/register',
    timestamp: new Date(now).toISOString(),
    requestId: '0bda3866-1566-4093-8999-19f409bfde61',
  },
  'Validation failed',
);

export function ComponentsLabPage() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h4" component="h2" gutterBottom>
          Phase 2 - component showcase
        </Typography>
        <Typography color="text.secondary">
          Each component in every state it supports, including the awkward ones.
        </Typography>
      </Box>

      <section>
        <Typography variant="h6" component="h3" gutterBottom>
          TaskCard
        </Typography>
        <Stack spacing={2}>
          {/*
            KEY IS THE SERVER ID, not the array index.

            This list is a candidate for sorting and filtering later, and the
            moment it reorders, index keys would make React reuse the wrong
            DOM node - a card's expanded/selected state would jump to a
            different task. Using a stable id costs nothing and is correct
            under every future change. Phase 4 demonstrates the corruption.
          */}
          {TASKS.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              /*
                Resolved by the PARENT, which is the whole point of the prop.
                In the real app this comes from the `TaskWithAssignee` the
                backend already returns - one request, not one per card.
              */
              assigneeName={task.assigneeId ? 'Phase One' : null}
              onSelect={setSelected}
              /*
                THE ACTIONS SLOT in use. The card knows nothing about what goes
                here - no `onEdit` prop, no `showMenu` flag. Composition rather
                than configuration, which is what stops this component growing
                a new prop every sprint.
              */
              actions={
                <IconButton size="small" aria-label={`Actions for ${task.title}`}>
                  <Typography aria-hidden>...</Typography>
                </IconButton>
              }
            />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Selected: {selected ?? 'none'} (click a card, or Tab to it and press Enter or Space)
        </Typography>
      </section>

      <section>
        <Typography variant="h6" component="h3" gutterBottom>
          LoadingState
        </Typography>
        <Stack spacing={2}>
          <LoadingState variant="skeleton" rows={2} />
          <LoadingState variant="spinner" label="Loading tasks..." />
        </Stack>
      </section>

      <section>
        <Typography variant="h6" component="h3" gutterBottom>
          EmptyState
        </Typography>
        <EmptyState
          title="No tasks yet"
          description="Tasks you create or that get assigned to you will appear here."
          /*
            An ARBITRARY NODE in the action slot. A config prop
            (`actionLabel` + `onAction`) could express this one button and
            would fail at the next request - an icon, a second button, a link.
          */
          action={<Button variant="contained">Create your first task</Button>}
          icon={<Typography aria-hidden>[ ]</Typography>}
        />
      </section>

      <section>
        <Typography variant="h6" component="h3" gutterBottom>
          ErrorState
        </Typography>
        <Stack spacing={2}>
          {/* Multi-field validation error - the string[] branch of the contract. */}
          <ErrorState
            error={VALIDATION_ERROR}
            title="Could not create your account"
            onRetry={() => undefined}
          />
          {/* A plain Error - the fallback branch. */}
          <ErrorState error={new Error('Failed to fetch')} onRetry={() => undefined} />
          {/*
            A thrown value that is not an Error at all. It renders a safe
            generic message instead of "[object Object]" - which is the whole
            reason `error` is typed `unknown`.
          */}
          <ErrorState error={{ weird: true }} />
        </Stack>
      </section>
    </Stack>
  );
}
