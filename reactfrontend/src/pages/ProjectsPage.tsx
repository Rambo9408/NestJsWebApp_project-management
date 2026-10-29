import { Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useGetProjectsQuery } from '@/features/projects/projectsApiSlice';
import { useDebounce } from '@/hooks/useDebounce';
import { buildPath, paths } from '@/routes/paths';
import { ProjectStatus, type Project } from '@/types/api';

/**
 * =============================================================================
 * ProjectsPage - the DataTable's first consumer
 * =============================================================================
 * The list is now SCOPED SERVER-SIDE to projects you own or belong to (the
 * collection-authorization fix). Before that fix this page would have shown
 * every project in the database to every user - which is worth remembering when
 * looking at how little code is here: the security is not in this file, and
 * cannot be.
 * =============================================================================
 */
export function ProjectsPage() {
  /**
   * `useSearchParams` DIRECTLY rather than a dedicated hook.
   *
   * `useUrlTaskFilters` exists because task filters are complex - five fields,
   * enum parsing, a page-reset invariant. Projects have two. Building a second
   * hook for two fields would be abstraction ahead of need; the Rule of Three
   * has not been reached.
   *
   * Worth stating explicitly because "we have a hook for that" is how a
   * codebase grows six near-identical filter hooks.
   */
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('search') ?? '';
  const statusParam = searchParams.get('status');
  const status =
    statusParam === ProjectStatus.ACTIVE || statusParam === ProjectStatus.ARCHIVED
      ? statusParam
      : 'all';
  const page = Number(searchParams.get('page')) || 1;

  const debouncedSearch = useDebounce(search, 400);

  const { data, isLoading, isFetching, isError, error, refetch } = useGetProjectsQuery({
    page,
    limit: 20,
    search: debouncedSearch.trim() || undefined,
    status: status === 'all' ? undefined : status,
  });

  const setFilter = (patch: Record<string, string>) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(patch)) {
        if (!value || value === 'all') next.delete(key);
        else next.set(key, value);
      }
      // THE PAGE-RESET INVARIANT, same rule as the task filters: any change
      // other than the page itself returns to page 1, or filtering while on
      // page 4 shows an empty list that reads as "no results".
      if (!('page' in patch)) next.delete('page');
      return next;
    });
  };

  /**
   * COLUMNS AT MODULE-ADJACENT SCOPE... but deliberately INSIDE the component.
   *
   * They close over nothing here, so they could be hoisted - and if this array
   * were rebuilt on every render while `DataTable` were memoised, that would
   * matter. It is not memoised, and the moment a column needs `can()` or a
   * mutation handler it must live inside anyway.
   *
   * Flagged rather than silently done: hoisting is the right call ONLY while
   * the columns stay data-independent, and that is a condition that tends to
   * stop holding.
   */
  const columns: Column<Project>[] = [
    {
      id: 'key',
      header: 'Key',
      width: 90,
      render: (project) => <Chip size="small" label={project.key} />,
    },
    {
      id: 'name',
      header: 'Name',
      render: (project) => (
        // A real <Link>, so middle-click and "open in new tab" work. An onClick
        // handler on the row would break both - Phase 2's point about the
        // polymorphic `component` prop, applied to a table cell.
        <Typography
          component={Link}
          to={buildPath(paths.projectDetail, { projectId: project.id })}
          sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 500 }}
        >
          {project.name}
        </Typography>
      ),
    },
    {
      id: 'members',
      header: 'Members',
      align: 'right',
      width: 110,
      render: (project) => project.members.length,
    },
    {
      id: 'status',
      header: 'Status',
      width: 130,
      render: (project) => (
        <Chip
          size="small"
          label={project.status}
          color={project.status === ProjectStatus.ACTIVE ? 'success' : 'default'}
          variant="outlined"
        />
      ),
    },
  ];

  const isFiltered = search !== '' || status !== 'all';

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h2" gutterBottom>
          Projects
        </Typography>
        <Typography color="text.secondary">
          Only projects you own or belong to. The backend enforces that scope - see the
          authorization audit.
        </Typography>
      </Box>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
        <TextField
          label="Search"
          size="small"
          value={search}
          onChange={(event) => {
            setFilter({ search: event.target.value });
          }}
          helperText={search !== debouncedSearch ? 'Waiting for you to finish typing...' : ' '}
          sx={{ minWidth: 220 }}
        />
        <TextField
          select
          label="Status"
          size="small"
          value={status}
          onChange={(event) => {
            setFilter({ status: event.target.value });
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="all">All statuses</MenuItem>
          <MenuItem value={ProjectStatus.ACTIVE}>Active</MenuItem>
          <MenuItem value={ProjectStatus.ARCHIVED}>Archived</MenuItem>
        </TextField>
        {isFiltered && (
          <Button
            size="small"
            onClick={() => {
              setSearchParams(new URLSearchParams());
            }}
          >
            Clear filters
          </Button>
        )}
      </Stack>

      <DataTable
        label="Projects"
        columns={columns}
        rows={data?.items}
        getRowId={(project) => project.id}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        page={data?.page}
        totalPages={data?.totalPages}
        onPageChange={(next) => {
          setFilter({ page: String(next) });
        }}
        emptyState={
          // The two-empty-states rule again: "you have none" and "none match"
          // call for different actions, and showing the first when the second
          // is true makes the user think their data is gone.
          isFiltered ? (
            <EmptyState
              title="No projects match these filters"
              description="Try widening the search, or clear the filters."
              action={
                <Button
                  onClick={() => {
                    setSearchParams(new URLSearchParams());
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No projects yet"
              description="Projects you create or are added to will appear here."
            />
          )
        }
      />
    </Stack>
  );
}
