import { describe, expect, it } from 'vitest';
import { can, type Capability } from './permissions';
import { Role, type User } from '@/types/api';

/**
 * =============================================================================
 * TESTING THE PERMISSION RULES
 * =============================================================================
 * NO `render` IN THIS FILE. `can()` is a pure function, so these are as fast
 * and as deterministic as arithmetic - the same argument made for the Phase 3
 * reducer and the Phase 8 slices.
 *
 * WHY THESE TESTS MATTER MORE THAN MOST: every rule here DUPLICATES a rule the
 * backend enforces, and duplicated rules drift. These tests do not stop the
 * BACKEND changing - nothing on this side can - but they pin what the client
 * currently believes, so a change is deliberate rather than accidental.
 *
 * THE THING THEY CANNOT CATCH, stated plainly: if someone tightens
 * `@ProjectRoles` on the backend, every test here still passes and the UI
 * silently starts showing buttons that 403. The real fix for that is
 * contract-level - a shared policy document, or an integration test that
 * exercises both. Worth naming in an interview rather than pretending the unit
 * tests close the loop.
 * =============================================================================
 */

const makeUser = (role: Role, id = 'u1'): User => ({
  id,
  email: 'a@b.com',
  name: 'Test User',
  role,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

const member = makeUser(Role.MEMBER);
const globalAdmin = makeUser(Role.ADMIN, 'admin-1');

/** Every capability, for the sweeping assertions below. */
const ALL: Capability[] = [
  'users:read',
  'users:manage',
  'activity-logs:read',
  'health:detail',
  'project:read',
  'project:update',
  'project:archive',
  'project:members:manage',
  'task:create',
  'task:update',
  'task:delete',
  'comment:create',
  'comment:delete',
];

describe('can()', () => {
  it('denies everything when nobody is signed in', () => {
    /**
     * A permission function that assumes a user is a permission function that
     * throws on the login page. `null` must be an ordinary, total "no".
     */
    for (const capability of ALL) {
      expect(can(null, capability)).toBe(false);
    }
  });

  it('grants everything to a GLOBAL admin', () => {
    /**
     * Mirrors `if (user.role === Role.ADMIN) return true` at the top of both
     * ProjectAccessGuard and TaskAccessGuard.
     *
     * NOTE NO PROJECT CONTEXT IS PASSED. That is the assertion: an admin needs
     * no membership, so the short-circuit must fire before any project check.
     * If someone reorders the function and puts the membership test first,
     * this fails.
     */
    for (const capability of ALL) {
      expect(can(globalAdmin, capability)).toBe(true);
    }
  });

  describe('platform-wide capabilities need the GLOBAL admin role', () => {
    it.each<Capability>(['users:read', 'users:manage', 'activity-logs:read', 'health:detail'])(
      'denies %s to a non-admin, even a project manager',
      (capability) => {
        /**
         * THE TEST THAT PINS THE TWO-ROLE-SYSTEM DISTINCTION.
         *
         * Being a MANAGER of a project grants nothing platform-wide. Passing
         * `projectRole: MANAGER` here and still expecting `false` is the whole
         * point - the same enum value means different things in different
         * scopes, and conflating them is the easiest mistake in this file.
         */
        expect(can(member, capability, { projectRole: Role.MANAGER })).toBe(false);
      },
    );
  });

  describe('project-scoped capabilities need PROJECT membership', () => {
    it('denies a user who is not a member', () => {
      // `projectRole: null` means "checked, and not a member".
      expect(can(member, 'project:read', { projectRole: null })).toBe(false);
      expect(can(member, 'task:update', { projectRole: null })).toBe(false);
    });

    it('denies when NO context is supplied at all', () => {
      /**
       * `undefined` means "we did not ask". Denying is the safe default, and
       * it is deliberately indistinguishable in OUTCOME from `null` while
       * remaining distinguishable in MEANING - see the note on
       * PermissionContext.
       *
       * A call site that forgets the context gets a hidden button rather than
       * a wrongly-shown one, which is the correct way for this to fail.
       */
      expect(can(member, 'project:read')).toBe(false);
      expect(can(member, 'task:delete')).toBe(false);
    });

    it('lets ANY member read the project and work on its tasks', () => {
      const context = { projectRole: Role.MEMBER };

      expect(can(member, 'project:read', context)).toBe(true);
      expect(can(member, 'task:create', context)).toBe(true);
      expect(can(member, 'task:update', context)).toBe(true);
      /**
       * DELETE TOO, which is worth pinning because it looks like an oversight.
       *
       * It mirrors the backend: `TaskAccessGuard` carries no `@ProjectRoles` on
       * the delete route, so any member may delete a task. A deliberate product
       * choice - a shared project means shared work - and this test is what
       * makes a future tightening a conscious change on both sides.
       */
      expect(can(member, 'task:delete', context)).toBe(true);
    });

    it.each<Capability>(['project:update', 'project:archive', 'project:members:manage'])(
      'requires the project MANAGER role for %s',
      (capability) => {
        // Mirrors @ProjectRoles(Role.MANAGER) on those three backend routes.
        expect(can(member, capability, { projectRole: Role.MEMBER })).toBe(false);
        expect(can(member, capability, { projectRole: Role.MANAGER })).toBe(true);
      },
    );
  });

  describe('comment:delete - the only rule that depends on the RESOURCE', () => {
    /**
     * Mirrors `TasksService.removeComment`: author, project MANAGER, or global
     * ADMIN.
     *
     * This is why `can()` takes a context object rather than just a user. A
     * permission model that cannot express "your own" is a model people work
     * around - usually by checking authorship inline next to the check, which
     * puts half the rule somewhere nobody looks.
     */
    it('lets the AUTHOR delete their own comment', () => {
      expect(
        can(member, 'comment:delete', { projectRole: Role.MEMBER, authorId: member.id }),
      ).toBe(true);
    });

    it('denies a member deleting a comment written by SOMEONE ELSE', () => {
      expect(
        can(member, 'comment:delete', { projectRole: Role.MEMBER, authorId: 'someone-else' }),
      ).toBe(false);
    });

    it('lets a project MANAGER moderate any comment', () => {
      expect(
        can(member, 'comment:delete', { projectRole: Role.MANAGER, authorId: 'someone-else' }),
      ).toBe(true);
    });

    it('denies a NON-MEMBER even for a comment they authored', () => {
      /**
       * An edge case that could not normally arise - you cannot author a
       * comment on a project you are not in - but it pins the ORDER of the
       * check: membership is required before authorship is even considered.
       *
       * If the rule were written `authorId === user.id || isProjectManager`,
       * this would pass wrongly. Ordering bugs in boolean expressions are
       * invisible on inspection and obvious in a test.
       */
      expect(
        can(member, 'comment:delete', { projectRole: null, authorId: member.id }),
      ).toBe(false);
    });
  });
});
