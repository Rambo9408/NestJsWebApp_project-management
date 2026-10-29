import { Box, Chip, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';

import { DataTable, type Column } from '@/components/tables/DataTable';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useDebounce } from '@/hooks/useDebounce';
import { useGetActivityLogsQuery } from '@/features/activity/activityApiSlice';
import type { ActivityLog } from '@/types/api';

/**
 * =============================================================================
 * ActivityLogPage - the audit view
 * =============================================================================
 * The last unimplemented item from the original brief's feature list, and the
 * one whose absence was easiest to miss: the capability `activity-logs:read`
 * has existed in features/auth/permissions.ts since Phase 11, complete with a
 * unit test asserting that only admins hold it.
 *
 * So the permission system correctly guarded a page that did not exist. The
 * test passed. Nothing pointed at the gap.
 *
 * That is the same shape as the dead `paths.taskDetail` constant and the
 * never-applied `@Throttle` decorator: a declaration that reads as an
 * implementation. Three instances in one project is enough to call it a
 * pattern worth watching for - **anything that declares intent without being
 * wired to an effect needs a test that fails when the effect is missing.**
 * =============================================================================
 */

/**
 * Turns `task.assigned` into `Task assigned`.
 *
 * DELIBERATELY GENERIC, rather than a lookup table of known events - and this
 * is the counterpart to typing `event` as `string` instead of a union.
 *
 * An audit log is append-only history. It can contain events written by a
 * version of the backend that no longer exists, and it will contain events
 * added after this page was written. A `Record<string, string>` of labels would
 * render `undefined` for anything unrecognised - showing a blank cell for a
 * real recorded event, which in an audit tool is worse than an ugly label.
 *
 * Formatting mechanically means a new backend event renders sensibly on the day
 * it ships, with no frontend change. The trade is prettiness for completeness,
 * and for an audit view completeness wins every time.
 */
function formatEvent(event: string): string {
  const words = event.replace(/[._-]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Renders the untyped `payload` without pretending to know its shape.
 *
 * `JSON.stringify` on an arbitrary object is a legitimate choice HERE
 * specifically because this is a developer/admin diagnostic surface, where
 * seeing the raw record is the point. The same rendering on a user-facing page
 * would be an admission that nobody decided what to show.
 *
 * SAFE FROM XSS because React escapes interpolated text - this is a string
 * rendered as a text node, not markup. The rule to remember is that the danger
 * is `dangerouslySetInnerHTML`, not untrusted strings.
 */
function formatPayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload);
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(', ');
}

export function ActivityLogPage() {
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState('');

  /**
   * DEBOUNCED, because this filter goes to the SERVER.
   *
   * Without it every keystroke is a request: typing "task.assigned" is
   * fourteen. RTK Query deduplicates identical arguments, but these are all
   * different, so every one is real network traffic and the results arrive out
   * of order.
   *
   * 300ms is the usual sweet spot - short enough to feel immediate, long enough
   * that ordinary typing produces one request. The hook is the one from Phase 3
   * (hooks/useDebounce.ts), where the effect CLEANUP clearing the previous
   * timer is the entire mechanism.
   */
  const debouncedEvent = useDebounce(eventFilter, 300);

  const { data, isLoading, isFetching, error, refetch } = useGetActivityLogsQuery({
    page,
    limit: 20,
    /**
     * `undefined` rather than `''` when the box is empty.
     *
     * RTK Query serialises the argument into the cache key, and it omits
     * undefined values from the query string. Sending `?event=` would be a
     * different cache entry from sending nothing AND would reach the backend as
     * an empty-string filter - where `if (query.event)` happens to treat it as
     * absent, so it works by luck rather than by contract.
     *
     * Relying on a falsy check on the other side of a network boundary is how
     * you get a bug the day someone tightens that condition.
     */
    event: debouncedEvent.trim() || undefined,
  });

  const columns: Column<ActivityLog>[] = [
    {
      id: 'createdAt',
      header: 'When',
      width: 190,
      render: (log) => (
        <Box component="time" dateTime={log.createdAt}>
          {new Date(log.createdAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </Box>
      ),
    },
    {
      id: 'event',
      header: 'Event',
      width: 200,
      render: (log) => <Chip size="small" label={formatEvent(log.event)} />,
    },
    {
      id: 'actorId',
      header: 'Actor',
      width: 220,
      /**
       * THE RAW ID, and this is a KNOWN LIMITATION rather than an oversight.
       *
       * The endpoint returns `actorId` with no join, so showing a name would
       * mean fetching every referenced user - and an audit page spans all
       * users, so it cannot piggyback on the 100-user cache the way the task
       * pages do.
       *
       * The options were: fetch users and accept an incomplete mapping, add a
       * join on the backend, or show the id. Showing the id is the honest one
       * until the backend change happens; a half-populated name column would
       * silently show "Unknown" for anyone outside the first page of users.
       *
       * Logged in ROADMAP.md alongside the identical issue on project member
       * lists - the same missing join, in two places.
       */
      render: (log) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
          {log.actorId}
        </Typography>
      ),
    },
    {
      id: 'payload',
      header: 'Details',
      render: (log) => (
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
          {formatPayload(log.payload)}
        </Typography>
      ),
    },
  ];

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        Activity log
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        A system-wide audit trail. Visible to administrators only — the backend enforces this with a
        class-level role guard; hiding the navigation link is a courtesy, not the boundary.
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          label="Filter by event"
          size="small"
          value={eventFilter}
          onChange={(e) => {
            setEventFilter(e.target.value);
            /**
             * RESET TO PAGE 1 WHENEVER THE FILTER CHANGES.
             *
             * Without this, filtering while on page 4 asks for page 4 of a
             * result set that may have one page — the server returns nothing
             * and the user sees "no results" for a filter that matches plenty.
             *
             * A classic pagination bug, and it is invisible in testing because
             * nobody filters from page 4.
             */
            setPage(1);
          }}
          placeholder="task.assigned"
          helperText="Matches the stored event name"
        />
      </Stack>

      <DataTable
        label="Activity log"
        columns={columns}
        rows={data?.items}
        getRowId={(log) => log.id}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        onRetry={() => void refetch()}
        emptyState={
          <EmptyState
            title="No activity recorded"
            description={
              eventFilter
                ? 'No events match that filter.'
                : 'Actions across the system will appear here.'
            }
          />
        }
        page={page}
        totalPages={data ? Math.ceil(data.total / data.limit) : 0}
        onPageChange={setPage}
      />
    </Box>
  );
}
