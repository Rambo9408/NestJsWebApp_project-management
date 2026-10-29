import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { Role } from 'src/common/enums/role.enum';
import { CacheService } from 'src/cache/cache.service';
import { NotificationsService, NotifyUserOptions } from 'src/notifications/notifications.service';
import { PublicUser } from 'src/users/entities/user.entity';
import { UsersService } from 'src/users/users.service';

import { ProjectStatus } from './entities/project.entity';
import { InMemoryProjectsRepository } from './repositories/in-memory-projects.repository';
import { ProjectsRepository } from './repositories/projects.repository';
import { ProjectsService } from './projects.service';

/**
 * =============================================================================
 * TESTING ACROSS A MODULE BOUNDARY
 * =============================================================================
 * `ProjectsService` depends on `UsersService`, which depends on
 * `UsersRepository`, `PasswordHasher` and `AppConfigService`. Testing it
 * without DI would mean constructing that entire chain.
 *
 * Instead we replace ONE token with a two-method fake. Nothing behind
 * `UsersService` is constructed at all - the container never needs to, because
 * we handed it an instance for that token.
 *
 * This is the concrete answer to "why bother with dependency injection?", and
 * it is the answer to give in an interview: not "loose coupling" as an
 * abstraction, but "I can substitute a collaborator at a seam the framework
 * already provides, without a mocking library and without touching production
 * code".
 *
 * It is also a preview of Phase 20: swapping `UsersService` for a remote client
 * when users become their own microservice is the exact same substitution -
 * same token, different implementation. If the test can do it, the architecture
 * can do it.
 * =============================================================================
 */
describe('ProjectsService', () => {
  let service: ProjectsService;

  const knownUser: PublicUser = {
    id: 'user-1',
    email: 'owner@example.com',
    name: 'Project Owner',
    role: Role.MANAGER,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const secondUser: PublicUser = { ...knownUser, id: 'user-2', email: 'member@example.com' };

  /**
   * The fake honours the REAL contract: `findById` throws NotFoundException for
   * an unknown id, exactly as `UsersService` does.
   *
   * That fidelity is the thing to get right. A fake that returns `null` where
   * the real one throws produces a green test suite and a broken application -
   * the most expensive kind of test. When a contract is subtle, this is the
   * argument for contract tests, or for testing against the real collaborator.
   */
  const fakeUsersService: Pick<UsersService, 'findById'> = {
    findById: (id: string) => {
      const user = [knownUser, secondUser].find((candidate) => candidate.id === id);
      if (!user) return Promise.reject(new NotFoundException(`User ${id} not found`));
      return Promise.resolve(user);
    },
  };

  /**
   * A RECORDING fake, not a silent one.
   *
   * `NoopNotificationChannel` exists for "I do not care whether it was sent";
   * this is for "I care that it happened, and with what". Choosing the silent
   * option here would give us a test that cannot fail.
   */
  const sentNotifications: NotifyUserOptions[] = [];
  const fakeNotifications: Pick<NotificationsService, 'notifyUser'> = {
    notifyUser: (options: NotifyUserOptions) => {
      sentNotifications.push(options);
      return Promise.resolve();
    },
  };

  beforeEach(async () => {
    sentNotifications.length = 0;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        // Phase 5: the port bound to the in-memory implementation - no database.
        { provide: ProjectsRepository, useClass: InMemoryProjectsRepository },
        { provide: UsersService, useValue: fakeUsersService },
        { provide: NotificationsService, useValue: fakeNotifications },
        /**
         * A PASS-THROUGH cache double: getOrSet always calls the factory,
         * invalidation is a no-op.
         *
         * Deliberately NOT a caching fake. These tests assert business rules,
         * and a fake that actually cached would make them depend on cache
         * behaviour - so a stale-cache bug would show up as a confusing failure
         * in a completely unrelated test. Caching is asserted in
         * cache.service.spec.ts, where it is the subject.
         */
        {
          provide: CacheService,
          useValue: {
            getOrSet: <T>(_key: string, factory: () => Promise<T>) => factory(),
            get: () => Promise.resolve(null),
            set: () => Promise.resolve(),
            del: () => Promise.resolve(),
            delByPrefix: () => Promise.resolve(0),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ProjectsService);
  });

  it('creates a project with the owner pre-registered as a manager', async () => {
    const project = await service.create(
      {
        key: 'web',
        name: 'Website Redesign',
      },
      knownUser.id,
    );

    expect(project.key).toBe('WEB'); // normalised to uppercase
    expect(project.status).toBe(ProjectStatus.ACTIVE);
    expect(project.members).toHaveLength(1);
    expect(project.members[0]).toMatchObject({ userId: knownUser.id, role: Role.MANAGER });
  });

  it('refuses to create a project for a non-existent owner', async () => {
    // The cross-module call is what rejects here - referential integrity
    // enforced in the application, since MongoDB has no foreign keys.
    await expect(
      service.create({ key: 'GHOST', name: 'Ghost Project' }, 'nobody'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a duplicate project key', async () => {
    await service.create({ key: 'API', name: 'API Platform' }, knownUser.id);

    await expect(
      service.create({ key: 'api', name: 'Another API' }, knownUser.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('adds a member and refuses to add them twice', async () => {
    const project = await service.create(
      {
        key: 'MOB',
        name: 'Mobile App',
      },
      knownUser.id,
    );

    const updated = await service.addMember(project.id, { userId: secondUser.id });
    expect(updated.members).toHaveLength(2);

    await expect(service.addMember(project.id, { userId: secondUser.id })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('notifies the new member exactly once', async () => {
    const project = await service.create({ key: 'NOT', name: 'Notify' }, knownUser.id);

    await service.addMember(project.id, { userId: secondUser.id });

    expect(sentNotifications).toHaveLength(1);
    expect(sentNotifications[0]).toMatchObject({
      email: secondUser.email,
      title: 'Added to project NOT',
    });
  });

  it('does not notify when adding a member fails', async () => {
    const project = await service.create({ key: 'DUP', name: 'Duplicate' }, knownUser.id);
    await service.addMember(project.id, { userId: secondUser.id });
    sentNotifications.length = 0;

    // The duplicate is rejected before the notification line is reached.
    // Asserting the ABSENCE matters: "we emailed you about something that did
    // not happen" is a real and embarrassing class of bug.
    await expect(service.addMember(project.id, { userId: secondUser.id })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(sentNotifications).toHaveLength(0);
  });

  it('refuses to remove the owner', async () => {
    const project = await service.create({ key: 'OPS', name: 'Ops' }, knownUser.id);

    await expect(service.removeMember(project.id, knownUser.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('archives idempotently', async () => {
    const project = await service.create({ key: 'OLD', name: 'Legacy' }, knownUser.id);

    const first = await service.archive(project.id);
    const second = await service.archive(project.id);

    expect(first.status).toBe(ProjectStatus.ARCHIVED);
    // Calling it twice is success, not an error - the same reasoning Phase 12
    // applies to queue consumers, where redelivery is a certainty.
    expect(second.status).toBe(ProjectStatus.ARCHIVED);
  });

  it('refuses to modify an archived project', async () => {
    const project = await service.create({ key: 'FRZ', name: 'Frozen' }, knownUser.id);
    await service.archive(project.id);

    await expect(service.update(project.id, { name: 'New name' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
