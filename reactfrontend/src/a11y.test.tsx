import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { expectNoA11yViolations } from '@/test/axe';

import { LoginForm } from '@/features/auth/LoginForm';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { TaskCard } from '@/features/tasks/components/TaskCard';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriorityBadge } from '@/components/ui/PriorityBadge';
import { VirtualList } from '@/components/tables/VirtualList';
import { Modal } from '@/components/modals/Modal';

import authReducer from '@/features/auth/authSlice';
import uiReducer from '@/features/ui/uiSlice';
import { apiSlice } from '@/services/apiSlice';
import { TaskPriority, TaskStatus, type Task } from '@/types/api';

/**
 * =============================================================================
 * ACCESSIBILITY — axe against every component that renders user-facing UI
 * =============================================================================
 * Written as a CONSOLIDATED pass rather than a rule per component, because the
 * failures worth finding are the ones nobody thought about — and you only find
 * those by pointing the tool at everything.
 *
 * READ src/test/axe.ts BEFORE TRUSTING A GREEN RUN. Automated tooling catches
 * roughly a third of real accessibility problems, and colour-contrast is
 * disabled here because jsdom has no layout engine. This is a floor, not a
 * certificate.
 * =============================================================================
 */

function makeStore() {
  return configureStore({
    reducer: { auth: authReducer, ui: uiReducer, [apiSlice.reducerPath]: apiSlice.reducer },
    middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
  });
}

/** Everything a component might need: store, router, theme comes from MUI defaults. */
function renderWithProviders(ui: ReactElement) {
  const store = makeStore();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Provider store={store}>
        <MemoryRouter>{children}</MemoryRouter>
      </Provider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}

const task: Task = {
  id: 'task-1',
  reference: 'AP-1',
  title: 'Wire the API slice',
  description: 'Replace the hand-rolled fetch.',
  projectId: 'project-1',
  createdById: 'user-9',
  assigneeId: 'user-1',
  status: TaskStatus.IN_PROGRESS,
  priority: TaskPriority.HIGH,
  dueDate: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('accessibility', () => {
  describe('forms', () => {
    it('LoginForm has no violations', async () => {
      const { container } = renderWithProviders(
        <LoginForm onLogin={() => Promise.reject(new Error('not called'))} />,
      );
      await expectNoA11yViolations(container);
    });

    it('RegisterForm has no violations', async () => {
      const { container } = renderWithProviders(
        <RegisterForm onRegister={() => Promise.reject(new Error('not called'))} />,
      );
      await expectNoA11yViolations(container);
    });
  });

  describe('feedback states', () => {
    it('EmptyState has no violations', async () => {
      const { container } = renderWithProviders(
        <EmptyState title="No tasks yet" description="They will appear here." />,
      );
      await expectNoA11yViolations(container);
    });

    it('ErrorState has no violations', async () => {
      const { container } = renderWithProviders(
        <ErrorState error={new Error('Something broke')} onRetry={() => undefined} />,
      );
      await expectNoA11yViolations(container);
    });

    it('LoadingState (spinner) has no violations', async () => {
      const { container } = renderWithProviders(<LoadingState variant="spinner" />);
      await expectNoA11yViolations(container);
    });

    it('LoadingState (skeleton) has no violations', async () => {
      const { container } = renderWithProviders(<LoadingState variant="skeleton" rows={3} />);
      await expectNoA11yViolations(container);
    });
  });

  describe('dialogs', () => {
    /**
     * THE MODAL EARNED ITS PLACE HERE BY SHIPPING A BUG.
     *
     * The first version set `aria-labelledby` on MUI's low-level `<Modal>` and
     * no `role` anywhere — because `<Modal>` is the primitive (portal, focus
     * trap, backdrop) and only `<Dialog>` assigns the dialog role for you.
     *
     * The result rendered identically, produced no warning, and announced as a
     * generic unnamed group. Caught by a `getByRole('dialog')` +
     * `toHaveAccessibleName` assertion in the comments flow test.
     *
     * NOTE WHAT AXE STILL CANNOT CHECK HERE, which is most of what makes a
     * dialog usable: that focus moves in on open, that it is trapped, and that
     * it RETURNS to the trigger on close. Those are behaviour over time, not
     * properties of a rendered tree. MUI provides them; this test does not
     * prove it. Same floor-not-certificate caveat as the rest of the suite.
     */
    it('Modal has no violations', async () => {
      const { container, baseElement } = renderWithProviders(
        <Modal open onClose={() => undefined} title="Delete comment">
          <Modal.Body>This cannot be undone.</Modal.Body>
          <Modal.Footer>
            <button type="button">Cancel</button>
            <button type="button">Delete</button>
          </Modal.Footer>
        </Modal>,
      );

      /**
       * `baseElement`, NOT `container` — and this is the detail that makes the
       * test real rather than vacuous.
       *
       * A modal renders through a PORTAL to document.body, so it is nowhere
       * inside `container`. Running axe on `container` scans an empty div and
       * reports zero violations for a dialog it never looked at: a green result
       * that means nothing.
       *
       * Testing Library's `baseElement` defaults to document.body, which is
       * where the portal actually mounted.
       */
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      await expectNoA11yViolations(baseElement);
    });
  });

  describe('data display', () => {
    it('TaskCard (non-interactive) has no violations', async () => {
      const { container } = renderWithProviders(<TaskCard task={task} assigneeName="Ada" />);
      await expectNoA11yViolations(container);
    });

    it('TaskCard (interactive) has no violations', async () => {
      /**
       * The interactive variant hand-rolls `role="button"` + `tabIndex` +
       * `onKeyDown` because a real <button> would nest interactive elements
       * inside the actions slot. Hand-rolled ARIA is exactly what axe exists to
       * check.
       */
      const { container } = renderWithProviders(
        <TaskCard
          task={task}
          assigneeName="Ada"
          onSelect={() => undefined}
          actions={
            <button type="button" aria-label="Task actions">
              ...
            </button>
          }
        />,
      );
      await expectNoA11yViolations(container);
    });

    it('StatusBadge and PriorityBadge have no violations', async () => {
      const { container } = renderWithProviders(
        <>
          <StatusBadge status={TaskStatus.DONE} />
          <PriorityBadge priority={TaskPriority.URGENT} />
        </>,
      );
      await expectNoA11yViolations(container);
    });

    it('DataTable has no violations', async () => {
      interface Row {
        id: string;
        name: string;
      }
      const columns: Column<Row>[] = [
        { id: 'name', header: 'Name', render: (r) => r.name, sortable: true },
        { id: 'id', header: 'Id', render: (r) => r.id },
      ];
      const { container } = renderWithProviders(
        <DataTable
          label="People"
          columns={columns}
          rows={[
            { id: 'a', name: 'Ada' },
            { id: 'b', name: 'Grace' },
          ]}
          getRowId={(r) => r.id}
          sortBy="name"
          sortDir="asc"
          onSortChange={() => undefined}
          page={1}
          totalPages={3}
          onPageChange={() => undefined}
        />,
      );
      await expectNoA11yViolations(container);
    });

    it('VirtualList has no violations', async () => {
      /**
       * Virtualization LIES to assistive technology by default: the DOM holds
       * 20 rows when the list has 10,000. `aria-setsize` and `aria-posinset`
       * are what restore the truth, and this is the check that they are present
       * and coherent.
       */
      const items = Array.from({ length: 500 }, (_, i) => ({ id: i, label: `Row ${String(i)}` }));
      const { container } = renderWithProviders(
        <VirtualList
          label="Rows"
          items={items}
          rowHeight={40}
          height={200}
          renderRow={(item) => <span>{item.label}</span>}
        />,
      );
      await expectNoA11yViolations(container);
    });
  });
});
