import { useCallback } from 'react';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from './authSlice';
import { can, type Capability, type PermissionContext } from './permissions';

/**
 * =============================================================================
 * usePermissions - the React binding for the pure `can()` function
 * =============================================================================
 * All the logic lives in `permissions.ts`. This hook does one thing: supply the
 * current user from the store so call sites do not have to.
 *
 *     const { can } = usePermissions();
 *     can('project:update', { projectRole });
 *
 * WHY BOTHER WITH A WRAPPER AT ALL: without it every call site reads
 * `useAppSelector(selectCurrentUser)` and then passes the user in - which is
 * three lines of ceremony per component and, more importantly, a place to
 * forget. A component that forgets the user gets `can(undefined, ...)` and
 * silently denies everything.
 *
 * ANGULAR BRIDGE: this is a `PermissionService` injected into a component, and
 * `<RequirePermission>` is the `*appHasPermission` structural directive you
 * would pair with it. Same two pieces; React expresses the second as a
 * component rather than a directive because it has no directive concept.
 * =============================================================================
 */
export function usePermissions() {
  const user = useAppSelector(selectCurrentUser);

  /**
   * `useCallback` so the returned function has a STABLE IDENTITY while the user
   * is unchanged.
   *
   * It matters because this escapes into consumers we cannot see - the Phase 3
   * argument for memoising at a hook boundary. A caller may list it in a
   * `useMemo` dependency array (filtering a nav list, say), and an unstable
   * identity there would recompute on every render and defeat the memo.
   *
   * `[user]` is the only dependency: the rules themselves are a pure module
   * function that never changes.
   */
  const check = useCallback(
    (capability: Capability, context?: PermissionContext) => can(user, capability, context),
    [user],
  );

  return { can: check, user };
}
