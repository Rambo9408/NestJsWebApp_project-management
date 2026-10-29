import { Box, Button, Divider, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import { Link, useParams } from 'react-router-dom';

import { CommentList } from '@/features/comments/CommentList';
import { useGetTaskQuery } from '@/features/tasks/tasksApiSlice';
import { useGetProjectQuery } from '@/features/projects/projectsApiSlice';
import { useProjectRole } from '@/features/projects/useProjectRole';
import { useGetUsersQuery } from '@/features/users/usersApiSlice';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriorityBadge } from '@/components/ui/PriorityBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { paths } from '@/routes/paths';
import { TaskStatus } from '@/types/api';

/**
 * =============================================================================
 * TaskDetailPage - the route that existed as a constant and nothing else
 * =============================================================================
 * `paths.taskDetail` had been declared in routes/paths.ts since Phase 5 and was
 * referenced NOWHERE. No route matched it, no link pointed at it, and anyone
 * navigating to /tasks/<id> got the 404 page.
 *
 * WHY THAT SURVIVED AS LONG AS IT DID is the interesting part, because nothing
 * in the toolchain could see it:
 *
 *   - TypeScript: `paths.taskDetail` is a valid string. Declaring a route
 *     constant and never routing it is not a type error.
 *   - ESLint: it IS exported and the object IS used, so no-unused-vars is
 *     satisfied.
 *   - The tests: nothing rendered it, so nothing failed.
 *   - The 404 route: `path: '*'` catches it and renders a legitimate-looking
 *     "not found" page. The failure mode is a plausible page, not an error.
 *
 * A dead route constant is the frontend equivalent of a configured-but-never-
 * applied rate limiter (Phase 18-19): infrastructure that reads as done. Both
 * were found by USING the thing rather than by reading it.
 *
 * THE DURABLE FIX is not this page - it is that every entry in `paths` now has
 * a corresponding route, asserted by a test in app/router.test.tsx. A constant
 * with no route is now a failing test rather than a 404 nobody hits until a
 * user pastes a link.
 * =============================================================================
 */
export function TaskDetailPage() {
  /**
   * `useParams` IS UNTYPED BY DEFAULT - it returns `Record<string, string |
   * undefined>`, because the router cannot know at compile time which route
   * matched.
   *
   * `noUncheckedIndexedAccess` in this project's tsconfig makes that
   * `undefined` visible rather than silently assumed, which is why the guard
   * below is required rather than defensive. Without that flag `taskId` would
   * be typed `string` and `useGetTaskQuery(taskId)` would compile while sending
   * a request to `/tasks/undefined`.
   */
  const { taskId } = useParams<{ taskId: string }>();

  const {
    data: task,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetTaskQuery(taskId ?? '', {
    /**
     * `skip` rather than a conditional hook call.
     *
     * `if (!taskId) return` before this line would break the Rules of Hooks -
     * the hook count would differ between renders. `skip` is the sanctioned
     * escape hatch: the hook still runs, it just does not fire a request.
     *
     * The same reasoning applies to every "fetch only when I have an id" case,
     * and reaching for an early return is the standard first mistake.
     */
    skip: !taskId,
  });

  /**
   * THE PROJECT IS FETCHED FOR ONE REASON: the viewer's role IN IT, which
   * decides whether comment moderation controls appear.
   *
   * This is a genuine WATERFALL - the project id comes from the task, so this
   * request cannot start until the first finishes. Worth naming honestly rather
   * than hiding, because "avoid waterfalls" is repeated as a rule and the
   * interesting part is when you accept one.
   *
   * WHY IT IS ACCEPTED HERE:
   *   - it is ONE extra round trip on a detail page, not one per row
   *   - the page is useful before it resolves; only the delete buttons wait
   *   - the alternative is a backend change (embed the viewer's project role in
   *     the task response), which couples the task endpoint to the caller's
   *     identity
   *
   * WHAT WOULD CHANGE THE ANSWER: if this pattern appeared on a list page, or
   * if the second request gated the whole render. Then it is worth the backend
   * change. A waterfall is a cost, not an error - the question is what it buys.
   */
  const { data: project } = useGetProjectQuery(task?.projectId ?? '', { skip: !task });
  const projectRole = useProjectRole(project);

  /**
   * Users are fetched to resolve the assignee's NAME, and the cache is doing
   * the work here: the tasks list already asked for this exact query, so this
   * is a cache hit with no request at all.
   *
   * That is the difference between server state in RTK Query and server state
   * copied into a slice - the deduplication is automatic and cross-component.
   */
  const { data: users } = useGetUsersQuery({ page: 1, limit: 100 });
  const assignee = users?.items.find((candidate) => candidate.id === task?.assigneeId);

  if (!taskId) {
    return <ErrorState error={new Error('No task id in the URL')} />;
  }

  // Error before loading: a failed request leaves `task` undefined, and a
  // loading check first would spin forever on a 404 or a 403.
  if (isError) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  if (isLoading || !task) {
    return <LoadingState variant="skeleton" rows={4} />;
  }

  const isOverdue =
    task.dueDate !== null && new Date(task.dueDate) < new Date() && task.status !== TaskStatus.DONE;

  return (
    <Stack spacing={3}>
      {/*
        A BREADCRUMB, because a detail page reached from a pasted link has no
        back button that means anything. `<Link>` and not `<a>`: an anchor would
        trigger a full page load and reset the store.
      */}
      <Stack direction="row" spacing={1} component="nav" aria-label="Breadcrumb">
        <MuiLink component={Link} to={paths.tasks} variant="body2">
          Tasks
        </MuiLink>
        <Typography variant="body2" color="text.secondary" aria-hidden>
          /
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {task.reference}
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          {/*
            `component="h2"` - the app shell owns the single h1 ("TaskFlow"), so
            every page heading is an h2. Consistent with every other page here,
            and it is what keeps the document outline coherent for anyone
            navigating by heading.
          */}
          <Typography variant="h4" component="h2">
            <Typography component="span" color="text.secondary" sx={{ mr: 1, fontWeight: 400 }}>
              {task.reference}
            </Typography>
            {task.title}
          </Typography>

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {project && (
              <MuiLink
                component={Link}
                to={paths.projectDetail.replace(':projectId', project.id)}
                variant="body2"
              >
                {project.name}
              </MuiLink>
            )}
          </Stack>

          {task.description ? (
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
              {task.description}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.disabled">
              No description
            </Typography>
          )}

          <Divider />

          {/*
            A DESCRIPTION LIST for field/value pairs, not a table and not divs.

            `<dl>`/`<dt>`/`<dd>` is the semantically correct element for
            metadata, and screen readers announce the association between term
            and value. A table would imply row/column relationships that do not
            exist here.
          */}
          <Box
            component="dl"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              columnGap: 3,
              rowGap: 1,
              m: 0,
            }}
          >
            <Typography component="dt" variant="body2" color="text.secondary">
              Assignee
            </Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>
              {/* Ternary, not `&&`: "Unassigned" is information, and a blank
                  space would leave the user unsure whether it is empty or still
                  loading. */}
              {assignee ? assignee.name : 'Unassigned'}
            </Typography>

            <Typography component="dt" variant="body2" color="text.secondary">
              Due
            </Typography>
            <Typography
              component="dd"
              variant="body2"
              sx={{ m: 0 }}
              color={isOverdue ? 'error.main' : undefined}
            >
              {task.dueDate
                ? `${new Date(task.dueDate).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}${isOverdue ? ' - overdue' : ''}`
                : 'No due date'}
            </Typography>

            <Typography component="dt" variant="body2" color="text.secondary">
              Created
            </Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>
              <Box component="time" dateTime={task.createdAt}>
                {new Date(task.createdAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </Box>
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <CommentList taskId={taskId} projectRole={projectRole} />
      </Paper>

      <Box>
        <Button component={Link} to={paths.tasks}>
          Back to tasks
        </Button>
      </Box>
    </Stack>
  );
}
