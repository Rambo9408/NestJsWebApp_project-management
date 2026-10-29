import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from '@/features/auth/authSlice';
import { Role, type Project } from '@/types/api';

/**
 * =============================================================================
 * useProjectRole - the missing half of the permission model
 * =============================================================================
 * Phase 10 built `can(user, capability, { projectRole })` and pointed out that
 * "is this user a manager?" is unanswerable without naming a project. This is
 * where the answer comes from.
 *
 * RETURNS `Role | null`, and the null is meaningful: it is "checked, and NOT a
 * member", which `can()` treats differently from `undefined` ("did not ask").
 * Returning `undefined` here would collapse that distinction at the one place
 * it can actually be resolved.
 *
 * -----------------------------------------------------------------------------
 * THE OWNER IS NOT AUTOMATICALLY IN `members` - and that is a real trap
 * -----------------------------------------------------------------------------
 * The backend's `memberId` filter matches "owner OR member":
 *
 *     { $or: [{ ownerId: memberId }, { 'members.userId': memberId }] }
 *
 * So a project can list you as owner without a corresponding `members` entry,
 * and a naive `members.find(...)` would tell the owner they are not a member of
 * their own project - hiding every management button from the one person who
 * definitely has permission.
 *
 * Mirroring the backend's `$or` exactly is the fix. Any place the client
 * re-derives a rule the server already expresses, the shapes must match or the
 * UI lies.
 * =============================================================================
 */
export function useProjectRole(project: Project | undefined): Role | null {
  const user = useAppSelector(selectCurrentUser);

  if (!project || !user) return null;

  /**
   * OWNER IMPLIES MANAGER. The backend's ProjectAccessGuard checks the members
   * array, and `ProjectsService.create` adds the owner as a MANAGER member - so
   * in practice the two agree. This is belt and braces for data created before
   * that behaviour, or by a migration.
   *
   * Being explicit about it is worth more than the check itself: it documents
   * that "owner" and "manager member" are two representations of the same
   * authority, which is not obvious from either type alone.
   */
  if (project.ownerId === user.id) return Role.MANAGER;

  return project.members.find((member) => member.userId === user.id)?.role ?? null;
}
