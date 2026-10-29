import { apiSlice } from '@/services/apiSlice';
import type { ListProjectsQuery, Paginated, Project } from '@/types/api';
import type {
  AddProjectMemberRequest,
  CreateProjectRequest,
  UpdateProjectRequest,
} from '@/types/requests';

/**
 * =============================================================================
 * PROJECT ENDPOINTS
 * =============================================================================
 * NOTE THE INVALIDATION ACROSS FEATURES. Archiving a project changes what the
 * TASK list should show (the backend refuses to add tasks to an archived
 * project), so `archiveProject` invalidates the Task LIST too.
 *
 * That only works because there is ONE api slice with a shared tag namespace -
 * the reason `apiSlice` is defined empty and features inject into it rather
 * than each owning its own `createApi`. Cross-feature invalidation is
 * impossible with per-feature slices, and it is exactly the case where manual
 * refetching gets forgotten.
 * =============================================================================
 */
export const projectsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getProjects: builder.query<Paginated<Project>, ListProjectsQuery>({
      query: (params) => ({ url: '/projects', params }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((project) => ({ type: 'Project' as const, id: project.id })),
              { type: 'Project' as const, id: 'LIST' },
            ]
          : [{ type: 'Project' as const, id: 'LIST' }],
    }),

    getProject: builder.query<Project, string>({
      query: (id) => `/projects/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Project', id }],
    }),

    createProject: builder.mutation<Project, CreateProjectRequest>({
      query: (body) => ({ url: '/projects', method: 'POST', body }),
      invalidatesTags: [{ type: 'Project', id: 'LIST' }],
    }),

    updateProject: builder.mutation<Project, { id: string; body: UpdateProjectRequest }>({
      query: ({ id, body }) => ({ url: `/projects/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Project', id },
        { type: 'Project', id: 'LIST' },
      ],
    }),

    archiveProject: builder.mutation<Project, string>({
      query: (id) => ({ url: `/projects/${id}/archive`, method: 'POST' }),
      /**
       * INVALIDATES THE TASK LIST as well as the project.
       *
       * An archived project rejects new tasks server-side, so a stale task list
       * would keep offering a "Create task" button that 409s. Cross-entity
       * invalidation is what stops the UI contradicting the API.
       */
      invalidatesTags: (_result, _error, id) => [
        { type: 'Project', id },
        { type: 'Project', id: 'LIST' },
        { type: 'Task', id: 'LIST' },
      ],
    }),

    addProjectMember: builder.mutation<Project, { id: string; body: AddProjectMemberRequest }>({
      query: ({ id, body }) => ({ url: `/projects/${id}/members`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Project', id }],
    }),

    removeProjectMember: builder.mutation<Project, { id: string; userId: string }>({
      query: ({ id, userId }) => ({ url: `/projects/${id}/members/${userId}`, method: 'DELETE' }),
      /**
       * ALSO INVALIDATES THE TASK LIST, and this one is a real correctness fix
       * rather than a nicety.
       *
       * The task list is SCOPED BY PROJECT MEMBERSHIP on the backend (the
       * collection-authorization fix). Remove yourself from a project and the
       * tasks you could see a moment ago are no longer yours to see - but the
       * cached list would keep showing them until something refetched.
       *
       * A cache that outlives the permission it was fetched under is a
       * genuinely subtle class of bug: the data is stale AND the staleness is
       * an access-control problem, not just a freshness one.
       */
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Project', id },
        { type: 'Project', id: 'LIST' },
        { type: 'Task', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetProjectsQuery,
  useGetProjectQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useArchiveProjectMutation,
  useAddProjectMemberMutation,
  useRemoveProjectMemberMutation,
} = projectsApiSlice;
