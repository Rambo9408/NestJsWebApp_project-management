import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PASSWORD_HASHER } from 'src/common/constants';
import { PaginationQuery } from 'src/common/dto/pagination.query';
import { Role } from 'src/common/enums/role.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppConfigService } from 'src/config';
import { DomainEvent, UserDeletionRequestedEvent } from 'src/events/domain-events';

import { PasswordHasher } from './hashing/password-hasher.interface';
import { InMemoryUsersRepository } from './repositories/in-memory-users.repository';
import { UsersRepository } from './repositories/users.repository';
import { UsersService } from './users.service';

/**
 * =============================================================================
 * WHAT TO MOCK, AND WHAT NOT TO
 * =============================================================================
 * Full testing strategy is Phase 14. What this spec demonstrates now is the
 * judgement call people get wrong most often: "unit test" does not mean "mock
 * every dependency".
 *
 *   UsersRepository  -> REAL. It is an in-memory Map with no I/O, it is fast,
 *                       and it is code we own. Mocking it would mean asserting
 *                       that we called `repository.create()` - a test of our
 *                       own mock rather than of behaviour. Using the real one
 *                       lets us assert on OUTCOMES ("the duplicate is
 *                       rejected"), which survives refactoring.
 *
 *   PasswordHasher   -> FAKE. bcrypt is deliberately slow (that is its job).
 *                       At cost factor 12, a suite with 50 registrations
 *                       spends 12 seconds hashing and tests nothing about
 *                       UsersService. Mock what is slow, non-deterministic, or
 *                       reaches outside the process.
 *
 *   AppConfigService -> STUB. We only need `isDevelopment` to be false so the
 *                       bootstrap seeder does not run.
 *
 * RULE OF THUMB: mock at the boundaries you do not own or cannot afford
 * (network, clock, randomness, expensive CPU). Do not mock your own cheap
 * collaborators - over-mocked tests pass while the app is broken, because they
 * only ever assert that mocks were called.
 *
 * MECHANISM NOTE: every entry in `providers` below is a custom provider -
 * `{ provide: TOKEN, useValue: ... }`. The token stays the same (the class,
 * used purely as a key); the recipe changes. Phase 3 formalises this.
 * =============================================================================
 */
describe('UsersService', () => {
  let service: UsersService;
  let repository: UsersRepository;

  /**
   * A fake hasher: deterministic, instant, and obviously not a real hash.
   *
   * PHASE 3 NOTE: because `UsersService` now depends on the INTERFACE behind the
   * PASSWORD_HASHER token, this fake only has to satisfy a three-member
   * contract - it does not have to be, extend, or mock a class. That is the
   * practical payoff of programming against a port: the test double is a plain
   * object literal that the compiler checks for you.
   */
  const fakeHasher: PasswordHasher = {
    algorithm: 'fake',
    hash: (plaintext: string) => Promise.resolve(`hashed:${plaintext}`),
    compare: (plaintext: string, hash: string) => Promise.resolve(hash === `hashed:${plaintext}`),
  };

  const stubConfig = { isDevelopment: false, isTest: true, isProduction: false };

  /**
   * PHASE 13: the veto is now a LISTENER, not a dependency.
   *
   * The spec used to stub `ProjectsService`. Now it registers a real
   * `EventEmitter2` and attaches a listener - which is closer to production,
   * and which is only possible because the coupling went away. Note the test
   * no longer mentions projects at all: it exercises the VETO MECHANISM, and
   * who happens to veto is somebody else's concern.
   */
  let ownedProjectCount = 0;
  const events = new EventEmitter2({ wildcard: true, delimiter: '.' });

  events.on(DomainEvent.USER_DELETION_REQUESTED, (event: UserDeletionRequestedEvent) => {
    if (ownedProjectCount > 0) {
      event.blockers.push(
        `Cannot delete a user who owns ${ownedProjectCount} active project(s); archive or transfer them first`,
      );
    }
  });

  beforeEach(async () => {
    ownedProjectCount = 0;
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        /**
         * PHASE 5: the port is now an ABSTRACT CLASS, so it is both the type
         * and the token. Production binds it to `MongoUsersRepository`; this
         * spec binds it to the in-memory one and needs no database at all.
         *
         * Note there is no `@Inject()` anywhere - that is the ergonomic
         * advantage of an abstract-class port over an interface + string token.
         */
        { provide: UsersRepository, useClass: InMemoryUsersRepository },
        // Same TOKEN as production, different RECIPE. That substitution is the
        // whole mechanism behind "DI makes code testable".
        { provide: PASSWORD_HASHER, useValue: fakeHasher },
        { provide: AppConfigService, useValue: stubConfig },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
    repository = moduleRef.get(UsersRepository);
  });

  describe('create', () => {
    it('creates a user and never returns the password hash', async () => {
      const user = await service.create({
        email: 'Ada@Example.com',
        name: 'Ada Lovelace',
        password: 'correct horse battery staple',
      });

      expect(user.id).toBeDefined();
      // Emails are normalised to lowercase so that lookups are case-insensitive.
      expect(user.email).toBe('ada@example.com');
      expect(user.role).toBe(Role.MEMBER);
      // The important assertion: the outbound type physically has no such key.
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('stores a hash, never the plaintext password', async () => {
      const created = await service.create({
        email: 'grace@example.com',
        name: 'Grace Hopper',
        password: 'super-secret',
      });

      // Reach past the service to check what was actually persisted. Asserting
      // that a secret is NOT stored in the clear is worth a dedicated test -
      // it is the kind of regression a refactor introduces silently.
      const stored = await repository.findById(created.id);
      expect(stored?.passwordHash).toBe('hashed:super-secret');
      expect(stored?.passwordHash).not.toContain('super-secret'.slice(0, 6) + 'X');
    });

    it('rejects a duplicate email with 409 Conflict, case-insensitively', async () => {
      await service.create({ email: 'dup@example.com', name: 'First', password: 'password123' });

      await expect(
        service.create({ email: 'DUP@example.com', name: 'Second', password: 'password123' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findById', () => {
    it('throws 404 for an unknown id', async () => {
      await expect(service.findById('does-not-exist')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update (role)', () => {
    it('refuses to demote the last remaining admin', async () => {
      const admin = await service.create({
        email: 'admin@example.com',
        name: 'Only Admin',
        password: 'password123',
        role: Role.ADMIN,
      });

      await expect(service.update(admin.id, { role: Role.MEMBER })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect((await service.findById(admin.id)).role).toBe(Role.ADMIN);
    });

    it('allows demoting an admin once another admin exists', async () => {
      const first = await service.create({
        email: 'admin1@example.com',
        name: 'Admin One',
        password: 'password123',
        role: Role.ADMIN,
      });
      await service.create({
        email: 'admin2@example.com',
        name: 'Admin Two',
        password: 'password123',
        role: Role.ADMIN,
      });

      const updated = await service.update(first.id, { role: Role.MEMBER });
      expect(updated.role).toBe(Role.MEMBER);
    });

    it('lets the only admin keep the admin role (no-op, not a demotion)', async () => {
      const admin = await service.create({
        email: 'admin@example.com',
        name: 'Only Admin',
        password: 'password123',
        role: Role.ADMIN,
      });

      await expect(service.update(admin.id, { role: Role.ADMIN })).resolves.toMatchObject({
        role: Role.ADMIN,
      });
    });
  });

  describe('remove', () => {
    it('refuses to delete the last remaining admin', async () => {
      const admin = await service.create({
        email: 'admin@example.com',
        name: 'Only Admin',
        password: 'password123',
        role: Role.ADMIN,
      });

      await expect(service.remove(admin.id)).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows deleting an admin once another admin exists', async () => {
      const first = await service.create({
        email: 'admin1@example.com',
        name: 'Admin One',
        password: 'password123',
        role: Role.ADMIN,
      });
      await service.create({
        email: 'admin2@example.com',
        name: 'Admin Two',
        password: 'password123',
        role: Role.ADMIN,
      });

      await expect(service.remove(first.id)).resolves.toBeUndefined();

      const { total } = await repository.findAll({ role: Role.ADMIN }, new PaginationQuery());
      expect(total).toBe(1);
    });

    it('refuses to delete a user who still owns active projects', async () => {
      const user = await service.create({
        email: 'owner@example.com',
        name: 'Owner',
        password: 'password123',
      });

      ownedProjectCount = 3; // the stubbed ProjectsService answer

      await expect(service.remove(user.id)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
