import type { ReactNode } from 'react';
import {
  Box,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';
import { LoadingState } from '@/components/feedback/LoadingState';
import { ErrorState } from '@/components/feedback/ErrorState';

/**
 * =============================================================================
 * DataTable - one table, every state
 * =============================================================================
 * Built because the users page and the projects page were about to grow the
 * same six branches: loading, error, empty, filtered-empty, rows, pagination.
 * That is the RULE OF THREE arriving - two near-identical implementations plus
 * a third on the way is when extraction stops being speculative.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - no data fetching. It takes `rows` and flags. RTK Query owns the request,
 *     and a table that fetches cannot be used with a list you already have.
 *   - no filter UI. Filters live in the URL (Phase 5) and differ per page.
 *   - no client-side sorting or paging. Both are server concerns here - see the
 *     note on `onSortChange`.
 *
 * Each omission keeps it PRESENTATIONAL, which is what makes it testable with a
 * plain array and reusable in a context it was not designed for.
 * =============================================================================
 */

/**
 * A column definition.
 *
 * GENERIC OVER THE ROW TYPE, and that is what makes the whole thing worth
 * having. `render` receives a fully-typed `row`, so `row.naem` is a compile
 * error rather than `undefined` in a cell.
 *
 * `render` rather than a `field` key, because most real columns are not a bare
 * value - they are a chip, a link, a formatted date, two fields joined. A
 * `field: keyof T` API covers the easy half and forces an escape hatch for the
 * rest; a render function covers both with one concept.
 */
export interface Column<T> {
  /** Stable identity for the column - also the sort key sent to the API. */
  id: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Omit to make the column unsortable. */
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  /** Stable row identity - the key. Never the array index (Phase 4). */
  getRowId: (row: T) => string;

  /** First load only. `isFetching` should NOT be passed here - see below. */
  isLoading?: boolean;
  /** Any in-flight request, including a background refetch. Dims the rows. */
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;

  /** Rendered when `rows` is empty. Callers pass the right one of two. */
  emptyState?: ReactNode;

  /** Server-side pagination. Omit `totalPages` to hide the control. */
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;

  /**
   * SERVER-SIDE SORTING. The table reports intent; it never reorders `rows`.
   *
   * WHY: sorting in the browser sorts THE CURRENT PAGE ONLY. On page 3 of 40,
   * "sort by name" would order fifty rows out of two thousand and look
   * completely wrong - and it is a bug people ship constantly, because it is
   * invisible on a single-page dataset during development.
   *
   * If the whole dataset genuinely fits in the client, sort in the client and
   * do not paginate at all. Mixing server pagination with client sorting is the
   * one combination that is always wrong.
   */
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (columnId: string, direction: 'asc' | 'desc') => void;

  /** Accessible name for the table. Required - see the caption note below. */
  label: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  isLoading,
  isFetching,
  error,
  onRetry,
  emptyState,
  page,
  totalPages,
  onPageChange,
  sortBy,
  sortDir = 'asc',
  onSortChange,
  label,
}: DataTableProps<T>) {
  /**
   * ORDER MATTERS: error before loading before empty.
   *
   * A failed refetch leaves stale `rows` in the cache, so checking `rows` first
   * would render the old data and silently hide the failure. The user would see
   * data that is quietly wrong - the worst of the three outcomes.
   */
  if (error) {
    return <ErrorState error={error} title={`Could not load ${label.toLowerCase()}`} onRetry={onRetry} />;
  }

  // `isLoading`, NOT `isFetching`. A skeleton on every background refetch blanks
  // the table each time the window regains focus (Phase 9).
  if (isLoading) return <LoadingState variant="skeleton" rows={5} />;

  if (!rows || rows.length === 0) {
    return emptyState ?? <Typography color="text.secondary">Nothing to show.</Typography>;
  }

  return (
    <Stack spacing={2}>
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{
          // Dim during a background refetch rather than replacing the content.
          opacity: isFetching ? 0.6 : 1,
          transition: 'opacity 150ms',
          /**
           * THE TABLE SCROLLS, NOT THE PAGE. Without this a wide table forces
           * horizontal scrolling on the whole document on a phone, which moves
           * the nav off-screen and is one of the most common responsive bugs.
           */
          overflowX: 'auto',
        }}
      >
        {/*
          `aria-label` on the table itself. A screen-reader user listing the
          landmarks on a page with two tables hears "table" twice and cannot
          tell them apart. It costs one prop, which is why `label` is required
          rather than optional.
        */}
        <Table size="small" aria-label={label}>
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                /*
                  `scope="col"` associates every cell below with this header.
                  Without it the table is read as an undifferentiated stream of
                  values, and MUI does not add it - the semantics are yours.
                */
                <TableCell
                  key={column.id}
                  scope="col"
                  align={column.align}
                  sx={{ width: column.width, whiteSpace: 'nowrap' }}
                  /*
                    `aria-sort` tells assistive tech the CURRENT sort state.
                    TableSortLabel renders an arrow, which is a visual-only
                    signal; this is the non-visual equivalent.
                  */
                  aria-sort={
                    sortBy === column.id
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  {column.sortable && onSortChange ? (
                    <TableSortLabel
                      active={sortBy === column.id}
                      direction={sortBy === column.id ? sortDir : 'asc'}
                      onClick={() => {
                        // Toggle if already sorted by this column, else start ascending.
                        const next = sortBy === column.id && sortDir === 'asc' ? 'desc' : 'asc';
                        onSortChange(column.id, next);
                      }}
                    >
                      {column.header}
                    </TableSortLabel>
                  ) : (
                    column.header
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {rows.map((row) => (
              // `getRowId`, never the index. Phase 4 showed what index keys do
              // to component state when a list reorders - and a sortable table
              // reorders by definition.
              <TableRow key={getRowId(row)} hover>
                {columns.map((column) => (
                  <TableCell key={column.id} align={column.align}>
                    {column.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/*
        Rendered only when there is more than one page. A lone "1" is noise that
        implies there might be more.
      */}
      {totalPages !== undefined && totalPages > 1 && onPageChange && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Pagination
            count={totalPages}
            page={page ?? 1}
            onChange={(_event, next) => {
              onPageChange(next);
            }}
            color="primary"
          />
        </Box>
      )}
    </Stack>
  );
}
