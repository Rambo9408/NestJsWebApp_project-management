import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { useParams } from 'react-router-dom';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { RequirePermission } from '@/components/auth/RequirePermission';
import { LoadingState } from '@/components/feedback/LoadingState';
import { ErrorState } from '@/components/feedback/ErrorState';
import {
  useArchiveProjectMutation,
  useGetProjectQuery,
  useRemoveProjectMemberMutation,
} from '@/features/projects/projectsApiSlice';
import { useProjectRole } from '@/features/projects/useProjectRole';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from '@/features/auth/authSlice';
import { ProjectStatus, Role, type ProjectMember } from '@/types/api';

/**
 * =============================================================================
 * ProjectDetailPage - where project-scoped permissions finally do real work
 * =============================================================================
 * Every gate on this page passes a `projectRole`, because that is the only way
 * the question means anything. `can('project:archive')` with no context denies -
 * correctly, and silently - which is exactly the failure mode Phase 10 designed
 * for: forget the context and you hide a button, never wrongly show one.
 * =============================================================================
 */
export function ProjectDetailPage() {
  /**
   * `useParams` returns `Record<string, string | undefined>` - every param is
   * optional, because TypeScript cannot know which route matched.
   *
   * The `?? ''` is honest rather than lazy: this component only renders under a
   * route that HAS `:projectId`, so it cannot really be undefined - and an
   * empty string produces a clean 400 from `ParseObjectIdPipe` rather than a
   * request to `/projects/undefined`, which is what the Phase 7 audit script
   * spent two runs debugging.
   */
  const { projectId = '' } = useParams();

  const { data: project, isLoading, isError, error, refetch } = useGetProjectQuery(projectId);
  const [archiveProject, { isLoading: isArchiving }] = useArchiveProjectMutation();
  const [removeMember, { isLoading: isRemoving }] = useRemoveProjectMemberMutation();

  const currentUser = useAppSelector(selectCurrentUser);

  /**
   * THE CONTEXT EVERY GATE ON THIS PAGE NEEDS.
   *
   * Resolved ONCE here and threaded down, rather than each gate deriving it.
   * Two components deriving the same rule is how they end up deriving it
   * slightly differently - and the owner-is-not-in-members trap in
   * `useProjectRole` is exactly the kind of detail that would be got right in
   * one place and wrong in the other.
   */
  const projectRole = useProjectRole(project);

  if (isLoading) return <LoadingState variant="spinner" label="Loading project..." />;

  if (isError || !project) {
    return (
      <ErrorState
        error={error}
        /**
         * A 404 HERE USUALLY MEANS "NOT A MEMBER", NOT "DOES NOT EXIST".
         *
         * `ProjectAccessGuard` returns 404 rather than 403 to non-members, so
         * it does not confirm the project exists to a stranger. The copy has to
         * be honest about that ambiguity instead of asserting one reading -
         * telling a user "this project does not exist" when it does and they
         * simply lack access sends them to support with the wrong question.
         */
        title="Project not found, or you do not have access"
        onRetry={() => void refetch()}
      />
    );
  }

  const memberColumns: Column<ProjectMember>[] = [
    {
      id: 'userId',
      header: 'User',
      render: (member) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {/*
            Only the id is available - the backend returns `members` as
            {userId, role, joinedAt} with no join. Resolving names would mean a
            request per member: the N+1 problem from Phase 2, at the member
            list this time.

            The honest options are to ask the backend to populate members (as it
            already does for task assignees), or to fetch the user list once and
            look up locally. Showing the raw id is the placeholder that makes
            the gap visible rather than hiding it behind fifty requests.
          */}
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {member.userId === currentUser?.id ? 'You' : member.userId.slice(-8)}
          </Typography>
        </Stack>
      ),
    },
    {
      id: 'role',
      header: 'Project role',
      width: 150,
      render: (member) => (
        <Chip
          size="small"
          label={member.role}
          color={member.role === Role.MANAGER ? 'primary' : 'default'}
          variant="outlined"
        />
      ),
    },
    {
      id: 'joinedAt',
      header: 'Joined',
      width: 140,
      render: (member) => new Date(member.joinedAt).toLocaleDateString(),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      width: 60,
      render: (member) => (
        /*
          THE PERMISSION GATE, WITH CONTEXT. Only a project MANAGER sees this,
          mirroring @ProjectRoles(Role.MANAGER) on DELETE /projects/:id/members.

          Without `context={{ projectRole }}` this would deny everyone - which
          is the safe direction to fail, and why the context is deliberately not
          defaulted to something permissive.
        */
        <RequirePermission capability="project:members:manage" context={{ projectRole }}>
          <IconButton
            size="small"
            disabled={isRemoving || member.userId === project.ownerId}
            // An accessible name per row. Forty buttons all announced as
            // "remove" tell a screen-reader user nothing about which row.
            aria-label={`Remove ${member.userId} from the project`}
            title={
              member.userId === project.ownerId
                ? 'The owner cannot be removed'
                : 'Remove from project'
            }
            onClick={() => {
              void removeMember({ id: project.id, userId: member.userId });
            }}
          >
            <Typography aria-hidden>&times;</Typography>
          </IconButton>
        </RequirePermission>
      ),
    },
  ];

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box sx={{ flexGrow: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <Chip size="small" label={project.key} />
            <Typography variant="h4" component="h2">
              {project.name}
            </Typography>
            {project.status === ProjectStatus.ARCHIVED && (
              <Chip size="small" label="archived" color="warning" />
            )}
          </Stack>
          <Typography color="text.secondary">{project.description || 'No description.'}</Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          {/*
            Both gated on the MANAGER project role. A plain member sees neither
            button - and if they forged a request anyway, the backend's
            @ProjectRoles(Role.MANAGER) refuses it. The button is UX; the
            decorator is the boundary.
          */}
          <RequirePermission capability="project:update" context={{ projectRole }}>
            <Button variant="outlined" size="small">
              Edit
            </Button>
          </RequirePermission>

          <RequirePermission capability="project:archive" context={{ projectRole }}>
            <Button
              variant="outlined"
              size="small"
              color="warning"
              disabled={isArchiving || project.status === ProjectStatus.ARCHIVED}
              onClick={() => {
                void archiveProject(project.id);
              }}
            >
              {project.status === ProjectStatus.ARCHIVED ? 'Archived' : 'Archive'}
            </Button>
          </RequirePermission>
        </Stack>
      </Stack>

      {/*
        THE ROLE BANNER. Telling a member WHY the management buttons are absent
        turns "this app is missing features" into "I need manager access".

        Hiding a control without explaining the rule is the most common way
        permission-driven UI confuses people - they cannot tell a missing
        feature from a forbidden one.
      */}
      <Typography variant="caption" color="text.secondary">
        Your role in this project: <strong>{projectRole ?? 'not a member'}</strong>
        {projectRole === Role.MEMBER && ' - managers can edit, archive and change members.'}
      </Typography>

      <Divider />

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h6" component="h3" sx={{ flexGrow: 1 }}>
          Members
        </Typography>
        <RequirePermission capability="project:members:manage" context={{ projectRole }}>
          <Button variant="contained" size="small">
            Add member
          </Button>
        </RequirePermission>
      </Stack>

      <DataTable
        label="Project members"
        columns={memberColumns}
        rows={project.members}
        // The membership row's identity is the user id - stable, and unique
        // within a project by construction.
        getRowId={(member) => member.userId}
      />
    </Stack>
  );
}
