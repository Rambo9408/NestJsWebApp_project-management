import {
  Box,
  Button,
  MenuItem,
  Pagination,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { paths } from '@/routes/paths';
import { useUrlTaskFilters } from '@/features/tasks/useUrlTaskFilters';
import { useGetTasksQuery } from '@/features/tasks/tasksApiSlice';
import { TaskCard } from '@/features/tasks/components/TaskCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { useDebounce } from '@/hooks/useDebounce';
import { TaskPriority, TaskStatus } from '@/types/api';

/**
 * =============================================================================
 * TasksPage - now backed by RTK Query
 * =============================================================================
 * COMPARE WITH THE PHASE 7 VERSION. That one needed:
 *
 *     const effectiveQuery = useMemo(...)      // stabilise the argument
 *     const fetcher = useCallback(...)         // stabilise the function
 *     const result = useAsyncData(fetcher, [effectiveQuery]);
 *
 * ...and BOTH memos were load-bearing. Drop either and the page refetches
 * forever, because a fresh object on every render compares unequal on every render.
 *
 * This version is one line:
 *
 *     const { data, isLoading, isError } = useGetTasksQuery(query);
 *
 * AND THE INLINE OBJECT IS SAFE. RTK Query SERIALISES the argument into a cache
 * key, so it compares by VALUE rather than by reference. That single design
 * choice deletes an entire class of bug - the one the Phase 3 hooks lab exists
 * to demonstrate.
 *
 * What else came free: caching, request deduplication, background refetch on
 * focus and reconnect, and automatic invalidation when a mutation changes a
 * task. None of it is written here.
 * =============================================================================
 */
export function TasksPage() {
  const { filters, setFilters, resetFilters, query, isFiltered } = useUrlTaskFilters();
  const navigate = useNavigate();

  /**
   * DEBOUNCE STILL MATTERS, and it is worth being clear about what it does now.
   *
   * RTK Query deduplicates IDENTICAL arguments; it does not merge DIFFERENT
   * ones. Typing "authentication" produces 14 distinct queries, so without a
   * debounce it is still 14 requests - each a legitimately different cache key.
   *
   * The input stays instant (it reads straight from the URL); only the value
   * that reaches the API is delayed.
   *
   * Phase 3's `useDebounce` doing exactly the job it was built for.
   */
  const debouncedSearch = useDebounce(filters.search, 400);

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useGetTasksQuery({
    ...query,
    search: debouncedSearch.trim() || undefined,
  });

  /**
   * `isLoading` vs `isFetching` - the distinction people miss, and it is the
   * difference between a good and a jarring UX.
   *
   *   isLoading   TRUE only on the FIRST load of this cache key, when there is
   *               no data to show. Render a skeleton.
   *   isFetching  TRUE for ANY in-flight request, including a background
   *               refetch while cached data is already on screen.
   *
   * Rendering a skeleton on `isFetching` would blank the list every time the
   * window regains focus - throwing away content the user was reading to show
   * them a loading state for data they already have.
   *
   * The right treatment for a background refetch is subtle: dim slightly, or a
   * thin progress bar. Never a full replacement.
   *
   * INTERVIEW: "what is the difference between isLoading and isFetching?" -
   * a reliable signal that someone has actually used RTK Query rather than read
   * about it.
   */

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h2" gutterBottom>
          Tasks
        </Typography>
        <Typography color="text.secondary">
          Live data via RTK Query. Filters live in the URL and are applied server-side.
        </Typography>
      </Box>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
        <TextField
          label="Search"
          size="small"
          value={filters.search}
          onChange={(event) => {
            setFilters({ search: event.target.value });
          }}
          helperText={
            filters.search !== debouncedSearch ? 'Waiting for you to finish typing...' : ' '
          }
          sx={{ minWidth: 220 }}
        />

        <TextField
          select
          label="Status"
          size="small"
          value={filters.status}
          onChange={(event) => {
            setFilters({ status: event.target.value as TaskStatus | 'all' });
          }}
          sx={{ minWidth: 160 }}
        >
          {/*
            'all' IS A UI SENTINEL, never sent to the API. `?status=all` fails
            @IsEnum(TaskStatus) with a 400 - verified in Phase 7. Both
            `toListTasksQuery` and `useUrlTaskFilters` drop it.
          */}
          <MenuItem value="all">All statuses</MenuItem>
          {Object.values(TaskStatus).map((status) => (
            <MenuItem key={status} value={status}>
              {status.replace('_', ' ')}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Priority"
          size="small"
          value={filters.priority}
          onChange={(event) => {
            setFilters({ priority: event.target.value as TaskPriority | 'all' });
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="all">All priorities</MenuItem>
          {Object.values(TaskPriority).map((priority) => (
            <MenuItem key={priority} value={priority}>
              {priority}
            </MenuItem>
          ))}
        </TextField>

        {isFiltered && (
          <Button onClick={resetFilters} size="small">
            Clear filters
          </Button>
        )}
      </Stack>

      {/* FIRST load only - there is no data to preserve. */}
      {isLoading && <LoadingState variant="skeleton" rows={4} />}

      {isError && (
        <ErrorState
          error={error}
          title="Could not load tasks"
          /*
            `refetch` comes from the hook. Note there is no attempt counter and
            no second code path - RTK Query owns the request lifecycle, so
            retrying is one function it already gave us.
          */
          onRetry={() => void refetch()}
        />
      )}

      {data &&
        (data.items.length === 0 ? (
          /*
            TWO DIFFERENT EMPTY STATES. "You have no tasks" and "no tasks match
            your filter" call for different actions - create one, versus widen
            the filter. Showing the first when the second is true makes the user
            think their data was deleted.
          */
          isFiltered ? (
            <EmptyState
              title="No tasks match these filters"
              description="Try widening the search, or clear the filters to see everything."
              action={<Button onClick={resetFilters}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              title="No tasks yet"
              description="Tasks you create or that get assigned to you will appear here."
              action={<Button variant="contained">Create a task</Button>}
            />
          )
        ) : (
          <Stack
            spacing={2}
            /*
              THE BACKGROUND-REFETCH TREATMENT. Dim the list slightly while a
              refetch runs, instead of replacing it with a skeleton. The user
              keeps reading; they just get a hint that fresher data is coming.

              `pointerEvents: none` prevents acting on rows that are about to
              be replaced - a small guard against clicking a task that has just
              been deleted by someone else.
            */
            sx={{
              opacity: isFetching ? 0.6 : 1,
              pointerEvents: isFetching ? 'none' : 'auto',
              transition: 'opacity 150ms',
            }}
          >
            {data.items.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                /*
                  The assignee comes from the LIST response - the backend joins
                  it, so 50 rows cost one query rather than 51. TaskCard taking
                  a plain `assigneeName` prop (Phase 2) is what makes that
                  possible; a card that fetched its own user would reintroduce
                  the N+1 no matter what the API returned.
                */
                assigneeName={task.assignee?.name ?? null}
                /*
                  NOW WIRED. `onSelect` had been part of TaskCard's API since
                  Phase 2 - with a keyboard handler, an accessible role, and its
                  own tests - and no caller ever passed it. The card's
                  interactive branch was dead code reached only by its unit
                  test.

                  Which is why the detail route being unrouted went unnoticed:
                  nothing linked to it. Two halves of one feature, each
                  individually complete, never connected. The tests passed
                  because each half was tested in isolation - exactly the gap
                  the "flow" test layer exists to catch.
                */
                onSelect={(id) => {
                  void navigate(paths.taskDetail.replace(':taskId', id));
                }}
              />
            ))}

            {data.totalPages > 1 && (
              <Stack sx={{ alignItems: 'center', pt: 1 }}>
                <Pagination
                  count={data.totalPages}
                  page={data.page}
                  onChange={(_event, page) => {
                    setFilters({ page });
                  }}
                  color="primary"
                />
              </Stack>
            )}

            <Typography variant="caption" color="text.secondary">
              Showing {data.items.length} of {data.total} - page {data.page} of{' '}
              {data.totalPages}
              {isFetching && ' - refreshing...'}
            </Typography>
          </Stack>
        ))}
    </Stack>
  );
}
