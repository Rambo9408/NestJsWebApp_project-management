import { apiSlice } from '@/services/apiSlice';
import type { ActivityLog, Paginated } from '@/types/api';

/**
 * =============================================================================
 * ACTIVITY LOG ENDPOINT
 * =============================================================================
 * SOURCE OF TRUTH: nestbackend/src/activity-logs/activity-logs.controller.ts
 *
 *   GET /activity-logs?page&limit&subjectId&event  ->  Paginated<ActivityLogView>
 *
 * ADMIN-ONLY, via a class-level `@Roles(Role.ADMIN)`. That is the boundary; the
 * `activity-logs:read` capability in features/auth/permissions.ts only decides
 * whether the nav link renders.
 *
 * -----------------------------------------------------------------------------
 * WHY AN AUDIT LOG IS ADMIN-ONLY WHEN ITS INDIVIDUAL EVENTS ARE NOT
 * -----------------------------------------------------------------------------
 * The backend states the reasoning and it is a genuinely good interview point:
 * an aggregate leaks more than the sum of the records it aggregates.
 *
 * A member may already be able to see that a task was reassigned. The LOG lets
 * them see who works on what, when people are active, which projects are busy,
 * and when someone's account changed - across the whole system. Each fact is
 * unremarkable; the collection is a surveillance tool.
 *
 * The same reasoning is why "this endpoint only returns data the user could
 * have gathered anyway" is a weak argument in a security review.
 *
 * -----------------------------------------------------------------------------
 * NO TAG TYPE - and that is deliberate
 * -----------------------------------------------------------------------------
 * Every other slice here provides and invalidates tags. This one does neither,
 * because an audit log is APPEND-ONLY HISTORY written as a side effect of other
 * operations. There is no mutation in this app whose result should invalidate
 * it, so a tag would be declared and never used - the same "infrastructure that
 * reads as done" that Phase 18-19 kept finding.
 *
 * The cost is that a newly written log entry is not visible until a refetch.
 * That is correct for an audit view: it is a record of the past, not a live
 * feed, and the page offers an explicit refresh.
 * =============================================================================
 */

export interface ListActivityArg {
  page?: number;
  limit?: number;
  /** Narrow to one project, task or user id. */
  subjectId?: string;
  event?: string;
}

export const activityApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getActivityLogs: builder.query<Paginated<ActivityLog>, ListActivityArg>({
      query: (params) => ({ url: '/activity-logs', params }),
    }),
  }),
});

export const { useGetActivityLogsQuery } = activityApiSlice;
