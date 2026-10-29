import { apiSlice } from '@/services/apiSlice';
import type { Paginated, PaginationQuery, Role, User } from '@/types/api';
import type { SetUserRoleRequest } from '@/types/requests';

/**
 * =============================================================================
 * USER ENDPOINTS - admin-only on the backend
 * =============================================================================
 * `UsersController` carries `@Roles(Role.ADMIN)` on the CLASS, so every route
 * here 403s for anybody else. Verified in the audit: a plain member calling
 * GET /users gets 403.
 *
 * The frontend guard (`RequireRole`) stops a member REACHING the page. This
 * slice would still 403 if they did - which is the point of having both, and
 * the point of neither being sufficient alone.
 * =============================================================================
 */
export interface ListUsersQuery extends PaginationQuery {
  search?: string;
  role?: Role;
}

export const usersApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getUsers: builder.query<Paginated<User>, ListUsersQuery>({
      query: (params) => ({ url: '/users', params }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((user) => ({ type: 'User' as const, id: user.id })),
              { type: 'User' as const, id: 'LIST' },
            ]
          : [{ type: 'User' as const, id: 'LIST' }],
    }),

    /**
     * PUT /users/:id/role - a DEDICATED endpoint rather than a field on PATCH.
     *
     * The backend author's note explains why, and it is a good API-design
     * point: a role change is a privilege escalation, not a profile edit. A
     * separate route can carry its own authorization, its own audit entry, and
     * its own rate limit - none of which you can attach to one field inside a
     * general-purpose PATCH.
     *
     * `PUT` rather than `PATCH` because it REPLACES the role outright; there is
     * no partial update of a single scalar.
     */
    setUserRole: builder.mutation<User, { id: string; body: SetUserRoleRequest }>({
      query: ({ id, body }) => ({ url: `/users/${id}/role`, method: 'PUT', body }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'User', id },
        { type: 'User', id: 'LIST' },
      ],
    }),
  }),
});

export const { useGetUsersQuery, useSetUserRoleMutation } = usersApiSlice;
