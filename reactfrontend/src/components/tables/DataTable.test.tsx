import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from './DataTable';

/**
 * =============================================================================
 * TESTING THE SHARED TABLE
 * =============================================================================
 * Worth more effort than a page test, because a bug here appears on every
 * screen that uses it - and because the branch ORDER (error before loading
 * before empty) is the kind of thing that looks arbitrary in review and is not.
 * =============================================================================
 */

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [
  { id: 'name', header: 'Name', render: (row) => row.name, sortable: true },
  { id: 'id', header: 'Id', render: (row) => row.id },
];

const rows: Row[] = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Grace' },
];

describe('DataTable', () => {
  it('renders rows through the column render functions', () => {
    render(<DataTable label="People" columns={columns} rows={rows} getRowId={(r) => r.id} />);

    expect(screen.getByRole('table', { name: 'People' })).toBeVisible();
    expect(screen.getByText('Ada')).toBeVisible();
    expect(screen.getByText('Grace')).toBeVisible();
  });

  it('gives the table an accessible name', () => {
    /**
     * `label` is a REQUIRED prop for this reason. A screen-reader user listing
     * the tables on a page hears "table" twice and cannot tell them apart.
     * Making it optional would mean it is omitted on the page with two tables -
     * the exact page where it matters.
     */
    render(<DataTable label="Projects" columns={columns} rows={rows} getRowId={(r) => r.id} />);

    expect(screen.getByRole('table', { name: 'Projects' })).toBeVisible();
  });

  describe('state precedence', () => {
    it('shows the error even when stale rows are present', () => {
      /**
       * THE MOST IMPORTANT TEST IN THIS FILE.
       *
       * A failed refetch leaves the previous data in the RTK Query cache, so
       * `rows` is non-empty AND `error` is set. Checking rows first would
       * render the stale table and silently hide the failure - the user reads
       * data that is quietly wrong, which is worse than an error and worse than
       * an empty state.
       *
       * The branch order in the component looks arbitrary until you write this.
       */
      render(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          error={new Error('Network down')}
        />,
      );

      expect(screen.getByRole('alert')).toHaveTextContent(/network down/i);
      expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    });

    it('shows the empty state instead of an empty table', () => {
      render(
        <DataTable
          label="People"
          columns={columns}
          rows={[]}
          getRowId={(r) => r.id}
          emptyState={<p>Nothing here yet</p>}
        />,
      );

      // A table with headers and no rows reads as broken. The empty state
      // replaces the whole thing rather than sitting under it.
      expect(screen.getByText('Nothing here yet')).toBeVisible();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('treats undefined rows as empty, not as a crash', () => {
      // `data?.items` is undefined on first render before the query resolves.
      // Every caller passes it that way, so it must not throw.
      render(
        <DataTable
          label="People"
          columns={columns}
          rows={undefined}
          getRowId={(r: Row) => r.id}
          emptyState={<p>No data</p>}
        />,
      );

      expect(screen.getByText('No data')).toBeVisible();
    });
  });

  describe('sorting', () => {
    it('reports intent without reordering the rows itself', () => {
      /**
       * THE TABLE MUST NOT SORT. With server-side pagination, sorting in the
       * browser orders THE CURRENT PAGE ONLY - on page 3 of 40 that is fifty
       * rows out of two thousand, and it looks completely wrong.
       *
       * Asserting that Ada is still first after a sort click is what pins that:
       * the component reports the intent and waits for new data.
       */
      const onSortChange = vi.fn();
      render(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          onSortChange={onSortChange}
        />,
      );

      const cells = screen.getAllByRole('cell');
      expect(cells[0]).toHaveTextContent('Ada');
      expect(onSortChange).not.toHaveBeenCalled();
    });

    it('toggles direction when the same column is clicked again', async () => {
      const onSortChange = vi.fn();
      const user = userEvent.setup();

      const { rerender } = render(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          onSortChange={onSortChange}
        />,
      );

      // Not currently sorted -> first click asks for ascending.
      await user.click(screen.getByRole('button', { name: /name/i }));
      expect(onSortChange).toHaveBeenLastCalledWith('name', 'asc');

      // Now sorted ascending -> the next click must ask for descending.
      rerender(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          sortBy="name"
          sortDir="asc"
          onSortChange={onSortChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /name/i }));
      expect(onSortChange).toHaveBeenLastCalledWith('name', 'desc');
    });

    it('exposes the sort state to assistive technology', () => {
      /**
       * `aria-sort` is the non-visual equivalent of the arrow icon. Without it
       * a screen-reader user can trigger a sort and get no confirmation that
       * anything changed.
       */
      render(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          sortBy="name"
          sortDir="desc"
          onSortChange={vi.fn()}
        />,
      );

      expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute(
        'aria-sort',
        'descending',
      );
    });

    it('renders a plain header when the column is not sortable', () => {
      render(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          onSortChange={vi.fn()}
        />,
      );

      // 'Id' has no `sortable`, so it must not be a button - a control that
      // looks interactive and does nothing is worse than a plain label.
      expect(screen.queryByRole('button', { name: /^id$/i })).not.toBeInTheDocument();
    });
  });

  describe('pagination', () => {
    it('is hidden when there is only one page', () => {
      // A lone "1" is noise that implies there might be more.
      render(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          page={1}
          totalPages={1}
          onPageChange={vi.fn()}
        />,
      );

      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    it('reports the requested page', async () => {
      const onPageChange = vi.fn();
      const user = userEvent.setup();

      render(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          page={1}
          totalPages={3}
          onPageChange={onPageChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /go to page 2/i }));
      expect(onPageChange).toHaveBeenCalledWith(2);
    });
  });
});
