import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';

import { PASSWORD_HASHER } from 'src/common/constants';
import { Paginated, PaginationQuery, paginate } from 'src/common/dto/pagination.query';
import { Role } from 'src/common/enums/role.enum';
import { AppConfigService } from 'src/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  DomainEvent,
  UserDeletionRequestedEvent,
  UserRegisteredEvent,
} from 'src/events/domain-events';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PublicUser, User, toPublicUser } from './entities/user.entity';
import { PasswordHasher } from './hashing/password-hasher.interface';
import { UserFilter, UsersRepository } from './repositories/users.repository';

/**
 * =============================================================================
 * UsersService - what "@Injectable()" actually means, in full
 * =============================================================================
 *
 * 1. WHAT IS A PROVIDER?
 * Anything the Nest container can create and inject: a service, a repository,
 * a factory, a plain value, a helper. "Provider" is a role, not a base class.
 * The formal definition is the useful one:
 *
 *     A provider is a { token, recipe } pair registered in a module.
 *
 * `providers: [UsersService]` is shorthand for
 * `{ provide: UsersService, useClass: UsersService }` - the class is both the
 * lookup KEY and the instruction for how to BUILD it. Phase 3 separates them.
 *
 * 2. WHY ARE SERVICES PROVIDERS?
 * Because they hold behaviour that other classes need, and DI makes that
 * dependency (a) declared, (b) resolvable at boot, and (c) replaceable in
 * tests. Compare the Express habit:
 *
 *     // users.service.js
 *     module.exports = new UsersService(require('./users.repository'));
 *
 * That is a hand-rolled singleton with a hard-coded dependency. It works, until
 * you want a second configuration of it, or a fake in a test, or you hit a
 * require-cycle.
 *
 * 3. WHAT EXACTLY DOES `@Injectable()` DO?
 * Less than most people think. It attaches `SCOPE_OPTIONS_METADATA` to the
 * class and - the important part - marks the class as decorated, which is what
 * makes TypeScript emit `design:paramtypes` for its constructor. It does NOT
 * register anything. Registration happens when a module lists the class in
 * `providers`. Two separate steps:
 *
 *     @Injectable()          -> "I can be injected, and here is my type info"
 *     providers: [X]         -> "in THIS module, X exists under token X"
 *
 * That is why a class with `@Injectable()` that nobody registers still produces
 * "Nest can't resolve dependencies".
 *
 * 4. HOW DOES NEST RESOLVE THIS CONSTRUCTOR?
 * For each parameter, in order:
 *   a. read the token (from `design:paramtypes`, or from `@Inject(TOKEN)`)
 *   b. look it up in THIS module's provider registry
 *   c. if absent, look in the exports of every module in THIS module's imports
 *   d. if absent, look among @Global() modules
 *   e. otherwise throw the "can't resolve dependencies" error, marking the
 *      failing parameter with `?`
 * Resolution is depth-first: a dependency is fully constructed before the
 * dependent. Each singleton is created once and memoised.
 *
 * 5. PROVIDER LIFECYCLE (interview favourite)
 *   instantiated during module init -> onModuleInit -> onApplicationBootstrap
 *   -> [application runs] -> onModuleDestroy -> beforeApplicationShutdown
 *   -> onApplicationShutdown
 * Singletons live for the whole process. That is why a provider holding
 * per-request state is a bug: two concurrent requests share the same object.
 *
 * 6. SEPARATION OF CONCERNS IN THIS CLASS
 * The service owns BUSINESS RULES ("emails are unique", "you cannot delete the
 * last admin"). It does not know about HTTP (no req/res, no status codes -
 * exceptions carry that meaning) and it does not know about storage (no Mongo
 * query syntax). That is what lets the same method be called later from a queue
 * worker or a WebSocket handler without modification.
 * =============================================================================
 */
@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  /**
   * THREE dependencies, three different origins - a compact map of resolution:
   *
   *   UsersRepository   - declared in THIS module's `providers`   (step b)
   *   PASSWORD_HASHER   - declared in THIS module's `providers`   (step b)
   *   AppConfigService  - exported by a @Global() module          (step d)
   *
   * Nothing here says WHERE they come from. The class states what it needs; the
   * module decides what satisfies it. That inversion is the point.
   *
   * ---------------------------------------------------------------------------
   * PHASE 3 CHANGE - look closely at the second parameter.
   * ---------------------------------------------------------------------------
   * It used to be `private readonly passwordHasher: PasswordHasher` where
   * `PasswordHasher` was a CLASS. Now it is an INTERFACE, and an interface has
   * no runtime existence, so the class token is gone. Without `@Inject()` the
   * emitted metadata for this parameter would be `Object`, and Nest would fail
   * with "can't resolve dependencies of the UsersService (UsersRepository, ?,
   * AppConfigService)".
   *
   *     @Inject(PASSWORD_HASHER)   <- supplies the runtime KEY
   *     hasher: PasswordHasher     <- supplies the compile-time TYPE
   *
   * Two systems, two jobs. This service now depends on a CONTRACT; the module
   * chooses the implementation. Swapping bcrypt for scrypt is a one-line change
   * in `users.module.ts` and this file does not move.
   *
   * NOTE: `@Inject()` overrides whatever `design:paramtypes` says, so it also
   * works on class-typed parameters - which is how you inject two different
   * instances of the SAME class (two Redis connections) by giving them
   * different tokens.
   */
  constructor(
    private readonly usersRepository: UsersRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    private readonly config: AppConfigService,

    /**
     * =========================================================================
     * PHASE 13 REPLACED THE CIRCULAR DEPENDENCY WITH THIS
     * =========================================================================
     * Phase 4 had, right here:
     *
     *     @Inject(forwardRef(() => ProjectsService))
     *     private readonly projectsService: ProjectsService,
     *
     * ...plus `forwardRef` on BOTH module import arrays, because `UsersService`
     * needed to ask `ProjectsService` a question before deleting a user.
     *
     * ALL OF THAT IS GONE. This service now depends on an EVENT BUS - a piece
     * of infrastructure - instead of on another feature module. The arrow that
     * pointed back at Projects points at nothing, `ProjectsModule` no longer
     * needs `forwardRef` either, and both modules can once again be understood,
     * tested and extracted on their own.
     *
     * That is Phase 4's option 4 ("invert the dependency with a domain event"),
     * and the diff is the whole lesson: `forwardRef` COMPILED. It did not fix
     * the design. This did.
     * =========================================================================
     */
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Runs after EVERY module has initialised - the right hook for work that may
   * touch other modules, and the right place for development seeding.
   *
   * WHY GUARD ON `isDevelopment`? Because a seeded admin with a known password
   * in production is a backdoor. Seeding logic that is not environment-gated is
   * a genuine breach waiting to happen; gate it, and never seed from the same
   * code path that runs in production.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.isDevelopment) return;
    if ((await this.usersRepository.count()) > 0) return;

    await this.create({
      email: 'admin@taskflow.dev',
      name: 'Dev Admin',
      password: 'ChangeMe123!',
      role: Role.ADMIN,
    });

    this.logger.warn('Seeded development admin: admin@taskflow.dev / ChangeMe123!');
  }

  async create(dto: CreateUserDto): Promise<PublicUser> {
    /**
     * BUSINESS RULE: emails are unique.
     *
     * `ConflictException` produces HTTP 409 - the correct code for "the request
     * is valid but conflicts with current state". 400 would say the request was
     * malformed (it was not) and 500 would blame the server (it should not).
     * Picking the right status is part of API design, not decoration: clients
     * retry 409 differently from 400.
     *
     * RACE CONDITION, stated honestly: check-then-insert is not atomic. Two
     * simultaneous registrations with the same email can both pass this check.
     * The real fix is a UNIQUE INDEX in the database, which Phase 5 adds - the
     * application check exists to produce a friendly message, and the index
     * exists to make the guarantee. "Validate in the app, enforce in the
     * database" is the rule, and it is a strong answer when an interviewer
     * probes concurrency.
     */
    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await this.passwordHasher.hash(dto.password);

    const user = await this.usersRepository.create({
      email: dto.email,
      name: dto.name.trim(),
      role: dto.role ?? Role.MEMBER,
      passwordHash,
    });

    this.logger.log(`User created: ${user.id}`);

    /**
     * FIRE AND FORGET - `emit`, not `emitAsync`.
     *
     * Nothing here depends on what the listeners do, and registration must not
     * wait for an activity-log write. This is the DEFAULT shape for a domain
     * event; the veto in `remove()` is the deliberate exception.
     */
    const registered: UserRegisteredEvent = {
      userId: user.id,
      email: user.email,
      name: user.name,
      actorId: user.id,
      occurredAt: new Date(),
    };
    this.events.emit(DomainEvent.USER_REGISTERED, registered);

    // Mapped at the boundary. The service returns a PublicUser, so a controller
    // physically cannot leak the hash even by accident.
    return toPublicUser(user);
  }

  async findAll(filter: UserFilter, pagination: PaginationQuery): Promise<Paginated<PublicUser>> {
    const { items, total } = await this.usersRepository.findAll(filter, pagination);
    return paginate(items.map(toPublicUser), total, pagination);
  }

  async findById(id: string): Promise<PublicUser> {
    return toPublicUser(await this.findEntityOrThrow(id));
  }

  /**
   * INTERNAL, and note the return type: the FULL `User`, including the hash.
   *
   * `AuthModule` needs this in Phase 7 to verify a password. It is exported
   * through `UsersService` (which IS exported) rather than by exposing the
   * repository, so the number of things that can see a password hash stays at
   * exactly two: this module, and auth.
   *
   * Naming it `...WithSecrets` is deliberate: a reviewer seeing this called
   * from a controller knows immediately that something is wrong.
   */
  async findByEmailWithSecrets(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(email);
  }

  /** INTERNAL: the full user including the hash. Used only by AuthModule. */
  async findByIdWithSecrets(id: string): Promise<User | null> {
    return this.usersRepository.findByIdWithSecrets(id);
  }

  /**
   * Set a new password.
   *
   * The CURRENT-password check lives in AuthService, not here: this method is
   * also the one an admin-initiated reset would use, where there is no current
   * password to verify. Keeping the credential check with the credential FLOW
   * and the storage concern here keeps both reusable.
   */
  async setPassword(id: string, plaintext: string): Promise<void> {
    await this.findEntityOrThrow(id);

    const passwordHash = await this.passwordHasher.hash(plaintext);
    await this.usersRepository.update(id, { passwordHash });

    this.logger.log(`Password updated for ${id}`);
  }

  /**
   * BUSINESS RULE: the system must always keep at least one admin, or nobody
   * can administer it. Two operations can break that - deleting an admin and
   * demoting one - so both go through this single check. Guarding only
   * `remove` left `PUT /users/:id/role` as a back door to the same outcome.
   */
  private async assertNotLastAdmin(message: string): Promise<void> {
    const { total } = await this.usersRepository.findAll(
      { role: Role.ADMIN },
      new PaginationQuery(),
    );
    if (total <= 1) throw new ConflictException(message);
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    const existing = await this.findEntityOrThrow(id);

    if (existing.role === Role.ADMIN && dto.role && dto.role !== Role.ADMIN) {
      await this.assertNotLastAdmin('Cannot demote the last remaining admin');
    }

    if (dto.email) {
      const owner = await this.usersRepository.findByEmail(dto.email);
      if (owner && owner.id !== id) {
        throw new ConflictException('A user with this email already exists');
      }
    }

    const updated = await this.usersRepository.update(id, {
      ...(dto.email ? { email: dto.email } : {}),
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(dto.role ? { role: dto.role } : {}),
    });

    // `update` returns null only if the record vanished between our lookup and
    // the write. Handling it keeps the type honest instead of using `!`.
    if (!updated) throw new NotFoundException(`User ${id} not found`);

    return toPublicUser(updated);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findEntityOrThrow(id);

    /**
     * BUSINESS RULE: never delete the last admin, or nobody can administer the
     * system. This is the kind of rule that belongs in a service and nowhere
     * else - not in a controller (it must hold for queue workers and scripts
     * too) and not in the database (it is domain policy, not data integrity).
     */
    if (user.role === Role.ADMIN) {
      await this.assertNotLastAdmin('Cannot delete the last remaining admin');
    }

    /**
     * =========================================================================
     * THE CROSS-AGGREGATE RULE, INVERTED
     * =========================================================================
     * Phase 4 wrote this as a direct call:
     *
     *     const owned = await this.projectsService.countActiveOwnedBy(id);
     *     if (owned > 0) throw new ConflictException(...);
     *
     * ...which required `UsersService` to know that projects exist, and closed
     * the dependency cycle.
     *
     * Now it ANNOUNCES AN INTENTION and lets anyone who objects say so.
     * `UsersService` does not know who is listening or why. `ProjectsModule`
     * has a listener that adds a blocker when the user still owns active
     * projects (`user-deletion.listener.ts`), and the day billing needs to veto
     * a deletion too, it adds a listener and NOTHING HERE CHANGES.
     *
     * WHY `emitAsync` AND NOT `emit`?
     * Because this one time we genuinely need the answers. `emit` is
     * fire-and-forget: it would return before any listener had run, and the
     * blockers array would still be empty. `emitAsync` awaits every listener.
     *
     * THE HONEST COST, because this is not free decoupling:
     *   - The emitter now WAITS for its listeners, so a slow listener slows the
     *     delete. That is the opposite of what an event bus usually buys.
     *   - This is a "collect objections" pattern, not a pure domain event -
     *     which is exactly why the event is named `..._requested` and its
     *     payload carries a mutable `blockers` array. Naming it `user.deleted`
     *     would hide the fact that a listener participates in the DECISION.
     *   - A listener that throws instead of adding a blocker aborts the whole
     *     delete with its own error. Listeners in this flow must be written to
     *     object, not to explode.
     *
     * WHEN THIS PATTERN IS WRONG: if the objection is a core invariant that
     * must never be bypassed, an event is too loose - anyone can forget to
     * register the listener, and there is no compile-time signal. A shared
     * "account lifecycle" service (Phase 4's option 3) is the stricter answer.
     * The trade here is deliberate: the rule is a policy, not an invariant, and
     * decoupling two feature modules is worth more than compile-time
     * enforcement of it.
     */
    const request: UserDeletionRequestedEvent = {
      userId: id,
      blockers: [],
      actorId: id,
      occurredAt: new Date(),
    };

    await this.events.emitAsync(DomainEvent.USER_DELETION_REQUESTED, request);

    if (request.blockers.length > 0) {
      throw new ConflictException(request.blockers.join('; '));
    }

    await this.usersRepository.remove(id);
    this.logger.log(`User removed: ${id}`);
  }

  /**
   * Private helper: fetch or 404.
   *
   * WHY THROW FROM A SERVICE INSTEAD OF RETURNING `null`? Because "this user
   * does not exist" is the same answer for every caller, and having one place
   * decide it prevents the far more common bug: a controller that forgets the
   * null check and returns `200 OK` with an empty body.
   *
   * Nest's built-in HTTP exceptions are a small, deliberate coupling: the
   * service knows "not found" maps to 404. The alternative - domain error
   * classes translated by an exception filter - is cleaner in a large system
   * and is what you would do if the same service also served gRPC. Phase 9
   * builds that filter and revisits this trade-off.
   */
  private async findEntityOrThrow(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }
}
