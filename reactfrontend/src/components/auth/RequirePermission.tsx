import type { ReactNode } from 'react';
import { usePermissions } from '@/features/auth/usePermissions';
import type { Capability, PermissionContext } from '@/features/auth/permissions';

/**
 * =============================================================================
 * RequirePermission - conditional rendering, declared rather than inlined
 * =============================================================================
 *     <RequirePermission capability="project:create">
 *       <CreateProjectButton />
 *     </RequirePermission>
 *
 * WHY A COMPONENT RATHER THAN `{can('x') && <Button />}`:
 *
 *   1. IT READS AS INTENT. The reason the button is conditional is in the
 *      markup, not inferred from a boolean expression.
 *   2. ONE PLACE TO CHANGE THE POLICY. Adding "and show a disabled button with
 *      a tooltip instead of hiding it" is an edit here, not across forty call
 *      sites.
 *   3. IT CANNOT BE HALF-DONE. The `{cond && ...}` form invites the Phase 2
 *      falsy-zero bug and invites forgetting the check entirely on the fifth
 *      button somebody adds.
 *
 * The inline form is not wrong for a one-off. This earns its place because
 * permission-gating appears everywhere in an RBAC app.
 * =============================================================================
 */

interface RequirePermissionProps {
  capability: Capability;
  /**
   * The subject being acted on. REQUIRED IN SPIRIT for project-scoped
   * capabilities, even though it is optional in the type - a check without
   * context falls back to "not a member" and denies.
   *
   * It is left optional because platform-wide capabilities (`users:manage`)
   * genuinely need none, and forcing `context={{}}` on those would be noise.
   */
  context?: PermissionContext;
  children: ReactNode;
  /**
   * What to render instead. Defaults to NOTHING.
   *
   * HIDE OR DISABLE? A real design decision, and the answer differs by case:
   *
   *   HIDE      when the user could never have the permission in this context.
   *             A member will not become a manager by reading a tooltip, and a
   *             disabled button they can never enable is just clutter.
   *
   *   DISABLE   with an explanation when the permission is ATTAINABLE, or when
   *             hiding it would make the UI look broken - a toolbar with three
   *             buttons for one user and one for another is disorienting, and
   *             people file bugs about missing features they never had.
   *
   * Hiding is the default because it is the safer of the two for information
   * disclosure: a disabled "Delete project" button tells a member that
   * deleting projects is a thing someone can do here.
   */
  fallback?: ReactNode;
}

export function RequirePermission({
  capability,
  context,
  children,
  fallback = null,
}: RequirePermissionProps) {
  const { can } = usePermissions();

  return can(capability, context) ? children : fallback;
}
