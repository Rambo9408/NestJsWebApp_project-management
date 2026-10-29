import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { useProjectRole } from './useProjectRole';
import authReducer, { sessionRestored } from '@/features/auth/authSlice';
import { ProjectStatus, Role, type Project, type User } from '@/types/api';

/**
 * =============================================================================
 * A HOOK THAT READS THE STORE - so this one DOES build a store
 * =============================================================================
 * Contrast with `permissions.test.ts`, which has no React at all because `can()`
 * is a pure function. The rule is not "never build a store in a test" - it is
 * "only build one when the thing under test genuinely needs it".
 *
 * A MINIMAL store, with just the auth slice. Importing the real one would drag
 * in RTK Query, its middleware and every endpoint, to test a function that reads
 * one field.
 * =============================================================================
 */

const user: User = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada',
  role: Role.MEMBER,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    key: 'AP',
    name: 'A Project',
    description: '',
    ownerId: 'someone-else',
    members: [],
    status: ProjectStatus.ACTIVE,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function wrapperFor(currentUser: User | null) {
  const store = configureStore({ reducer: { auth: authReducer } });
  if (currentUser) store.dispatch(sessionRestored({ user: currentUser }));

  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe('useProjectRole', () => {
  it('returns the membership role', () => {
    const project = makeProject({
      members: [{ userId: user.id, role: Role.MEMBER, joinedAt: '2026-08-01T00:00:00.000Z' }],
    });

    const { result } = renderHook(() => useProjectRole(project), { wrapper: wrapperFor(user) });

    expect(result.current).toBe(Role.MEMBER);
  });

  it('returns MANAGER for a manager membership', () => {
    const project = makeProject({
      members: [{ userId: user.id, role: Role.MANAGER, joinedAt: '2026-08-01T00:00:00.000Z' }],
    });

    const { result } = renderHook(() => useProjectRole(project), { wrapper: wrapperFor(user) });

    expect(result.current).toBe(Role.MANAGER);
  });

  it('treats the OWNER as a manager even with no members entry', () => {
    /**
     * THE TRAP THIS HOOK EXISTS TO AVOID.
     *
     * The backend's scope filter matches "owner OR member":
     *     { $or: [{ ownerId }, { 'members.userId': ... }] }
     *
     * So a project can name you as owner without a corresponding `members` row.
     * A naive `members.find(...)` would return null and tell the OWNER they are
     * not a member of their own project - hiding every management button from
     * the one person who definitely has permission.
     *
     * Any place the client re-derives a rule the server already expresses, the
     * shapes have to match or the UI lies.
     */
    const project = makeProject({ ownerId: user.id, members: [] });

    const { result } = renderHook(() => useProjectRole(project), { wrapper: wrapperFor(user) });

    expect(result.current).toBe(Role.MANAGER);
  });

  it('returns null - not undefined - for a non-member', () => {
    /**
     * `null` MEANS "checked, not a member". `undefined` means "did not ask".
     *
     * `can()` treats them the same way (both deny) but they mean different
     * things, and this hook is the one place the distinction can actually be
     * resolved. Returning `undefined` here would throw that away at source.
     */
    const project = makeProject({ members: [] });

    const { result } = renderHook(() => useProjectRole(project), { wrapper: wrapperFor(user) });

    expect(result.current).toBeNull();
  });

  it('returns null while the project is still loading', () => {
    // `data` is undefined on first render. A hook that throws there would take
    // down every consumer during the normal loading path.
    const { result } = renderHook(() => useProjectRole(undefined), { wrapper: wrapperFor(user) });

    expect(result.current).toBeNull();
  });

  it('returns null when nobody is signed in', () => {
    const project = makeProject({
      members: [{ userId: user.id, role: Role.MANAGER, joinedAt: '2026-08-01T00:00:00.000Z' }],
    });

    const { result } = renderHook(() => useProjectRole(project), { wrapper: wrapperFor(null) });

    expect(result.current).toBeNull();
  });
});
