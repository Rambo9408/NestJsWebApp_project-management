import { Box, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useGetUsersQuery, useSetUserRoleMutation } from '@/features/users/usersApiSlice';
import { usePermissions } from '@/features/auth/usePermissions';
import { Role, type User } from '@/types/api';

/**
 * =============================================================================
 * AdminUsersPage - the page RequireRole protects
 * =============================================================================
 * REWRITTEN ONTO DataTable, and that is the point of including the rewrite
 * rather than only the new page: an abstraction that has exactly one consumer
 * has not been shown to be reusable. Moving an EXISTING page onto it is the
 * test, and it is where a too-specific API gets found.
 *
 * What the move actually removed: the loading branch, the error branch, the
 * empty branch, the `isFetching` dimming, the `<TableContainer>` boilerplate
 * and the `scope="col"` headers that are easy to forget. What it kept: the
 * columns, which are the only part that is genuinely about users.
 * =============================================================================
 */
export function AdminUsersPage() {
  const { data, isLoading, isFetching, isError, error, refetch } = useGetUsersQuery({ limit: 50 });
  const [setUserRole, { isLoading: isUpdating }] = useSetUserRoleMutation();
  const { can, user: currentUser } = usePermissions();

  const columns: Column<User>[] = [
    { id: 'name', header: 'Name', render: (user) => user.name },
    { id: 'email', header: 'Email', render: (user) => user.email },
    {
      id: 'role',
      header: 'Global role',
      width: 220,
      render: (user) =>
        /*
          `can('users:manage')` rather than an inline `currentUser.role ===
          ADMIN`. The rule lives in permissions.ts, cited against the backend;
          re-deriving it here is how the two drift.

          NOTE it needs no context - this is a PLATFORM capability, decided by
          the global role alone. Contrast with every gate on the project detail
          page, all of which pass `{ projectRole }`.
        */
        can('users:manage') ? (
          <RoleSelect
            user={user}
            currentUserId={currentUser?.id}
            disabled={isUpdating}
            onChange={(role) => {
              void setUserRole({ id: user.id, body: { role } });
            }}
          />
        ) : (
          <Chip size="small" label={user.role} />
        ),
    },
  ];

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h2" gutterBottom>
          Users
        </Typography>
        <Typography color="text.secondary">
          Global roles. A user&apos;s role WITHIN a project is separate - set it from that
          project&apos;s member list.
        </Typography>
      </Box>

      <DataTable
        label="Users"
        columns={columns}
        rows={data?.items}
        getRowId={(user) => user.id}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyState={<EmptyState title="No users" description="Nobody has registered yet." />}
      />
    </Stack>
  );
}

function RoleSelect({
  user,
  currentUserId,
  disabled,
  onChange,
}: {
  user: User;
  currentUserId: string | undefined;
  disabled: boolean;
  onChange: (role: Role) => void;
}) {
  /**
   * YOU CANNOT DEMOTE YOURSELF.
   *
   * Not a security rule - an admin can trivially do it with curl, and the
   * backend allows it. It is a FOOT-GUN GUARD: in a system with one
   * administrator, demoting yourself locks everybody out of the admin area
   * permanently, with no in-app way back.
   *
   * WORTH SAYING IN AN INTERVIEW: "the frontend is not a security boundary"
   * does not mean the frontend should let users destroy things. Preventing an
   * irreversible MISTAKE is a legitimate client-side job, distinct from
   * preventing an unauthorised ACTION. The real fix is a backend rule refusing
   * to remove the last admin - flagged, not done.
   */
  const isSelf = user.id === currentUserId;

  return (
    <TextField
      select
      size="small"
      value={user.role}
      disabled={disabled || isSelf}
      onChange={(event) => {
        onChange(event.target.value as Role);
      }}
      // An accessible name per row. Forty selects all announced as "Global
      // role" tell a screen-reader user nothing about which row they are on.
      label={`Role for ${user.name}`}
      helperText={isSelf ? 'You cannot change your own role' : ' '}
      sx={{ minWidth: 180 }}
    >
      {Object.values(Role).map((role) => (
        <MenuItem key={role} value={role}>
          {role}
        </MenuItem>
      ))}
    </TextField>
  );
}
