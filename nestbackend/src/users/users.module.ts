import { Module, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PASSWORD_HASHER } from 'src/common/constants';

import { BcryptPasswordHasher } from './hashing/bcrypt-password-hasher';
import { MongoUsersRepository } from './repositories/mongo-users.repository';
import { UsersRepository } from './repositories/users.repository';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * =============================================================================
 * CUSTOM PROVIDER #2: `useClass`
 * =============================================================================
 *     { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher }
 *
 * Read it as: "when someone asks for the token PASSWORD_HASHER, instantiate
 * BcryptPasswordHasher (resolving ITS constructor dependencies first) and hand
 * them that instance."
 *
 * TOKEN and RECIPE are now visibly different things - which is the entire point
 * of Phase 3. `providers: [UsersService]` is the degenerate case where they
 * happen to be the same object.
 *
 * WHY THIS IS WORTH THE EXTRA LINE:
 *   - To move the whole application onto scrypt, change `BcryptPasswordHasher`
 *     to `ScryptPasswordHasher` here. Nothing else in the codebase changes -
 *     not UsersService, not its tests, not the controller.
 *   - `UsersService` now depends on a CONTRACT (`PasswordHasher`), not on a
 *     concrete class. That is Dependency Inversion, and this file is where the
 *     decision it enables actually gets made.
 *   - A module is the right place for that decision: it is the composition
 *     point, the one file whose job is to say which concrete pieces the
 *     application is built from.
 *
 * WHEN NOT TO BOTHER: if there is genuinely only ever going to be one
 * implementation and it is cheap in tests, `providers: [TheClass]` is fine.
 * Introducing a port for a class you will never swap is architecture theatre.
 * Here the port earns its keep twice over - hashing algorithms really do get
 * deprecated, and bcrypt really is too slow to run in a test suite.
 *
 * -----------------------------------------------------------------------------
 * THE `useClass` GOTCHA THAT COSTS PEOPLE AN AFTERNOON
 * -----------------------------------------------------------------------------
 * If you ALSO register the class directly:
 *
 *     providers: [
 *       BcryptPasswordHasher,                                   // instance A
 *       { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },  // instance B
 *     ]
 *
 * you get TWO INDEPENDENT INSTANCES. `useClass` means "build one for this
 * token", not "reuse the one you already built". Two sets of internal state,
 * two connections, two caches.
 *
 * When you want the token to be an ALIAS for an existing provider, the correct
 * recipe is `useExisting`. We demonstrate the difference - with a test that
 * asserts on object identity - in `src/notifications/notifications.module.ts`.
 *
 * Note this file registers the class ONLY through the token. That is
 * deliberate: nothing should be able to reach `BcryptPasswordHasher` by its
 * class, because depending on the concrete class is precisely what the port
 * exists to prevent.
 * =============================================================================
 */
/**
 * PHASE 5: the repository port is bound to the MongoDB implementation.
 * One line - the whole 'swap the database' step. Unit tests bind the same
 * token to InMemoryUsersRepository and touch no database at all.
 */
const usersRepositoryProvider: Provider = {
  provide: UsersRepository,
  useClass: MongoUsersRepository,
};

const passwordHasherProvider: Provider = {
  provide: PASSWORD_HASHER,
  useClass: BcryptPasswordHasher,

  // To migrate the whole app to scrypt, this single line becomes:
  //   useClass: ScryptPasswordHasher,
  // (In reality you would ship a facade that VERIFIES both formats and re-hashes
  //  on successful login - you cannot bulk re-hash without the plaintexts. See
  //  the comments in scrypt-password-hasher.ts.)
};

/**
 * =============================================================================
 * UsersModule - the first FEATURE MODULE, and the encapsulation lesson
 * =============================================================================
 * Read the three arrays as three statements:
 *
 *   controllers -> "these classes answer HTTP requests"
 *   providers   -> "build these for me; they are MINE"
 *   exports     -> "of those, other modules may use ONE"
 *
 * THE PUBLIC API OF THIS MODULE IS EXACTLY ONE PROVIDER: `UsersService`.
 *
 * `UsersRepository` and the PASSWORD_HASHER provider are private - not by
 * oversight, but as the module's contract:
 *
 *   - If another module could inject `UsersRepository`, it could write user
 *     documents without going through the rules in `UsersService` (unique
 *     email, cannot delete the last admin). Every rule would become a
 *     convention rather than a guarantee.
 *   - If another module could inject PASSWORD_HASHER, hashing would spread, and
 *     the argon2 migration would mean auditing the whole codebase instead of
 *     one folder.
 *
 * PROVE IT TO YOURSELF (five minutes, worth every one):
 * add `@Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher` to
 * `ProjectsService`, keep `imports: [UsersModule]`, and boot:
 *
 *     Nest can't resolve dependencies of the ProjectsService (ProjectsRepository,
 *     UsersService, NotificationsService, ?). Please make sure that the
 *     "TASKFLOW_PASSWORD_HASHER" property at index [3] is available in the
 *     ProjectsModule context.
 *
 * TypeScript compiled it. The token is exported from its file. The module was
 * imported. It still fails - because module encapsulation is a RUNTIME
 * container rule, not a compiler rule. This is the boundary Express cannot give
 * you, and the single most useful thing to be able to explain about Nest
 * modules in an interview.
 *
 * -----------------------------------------------------------------------------
 * THE THREE WRONG FIXES
 * -----------------------------------------------------------------------------
 *   1. Add the provider to `exports`.
 *      Encapsulation gone; every rule above becomes optional. Legitimate ONLY
 *      if you genuinely intend it as public API.
 *
 *   2. Re-register it in `ProjectsModule.providers`.
 *      This "works" and is the most damaging option: it silently creates a
 *      SECOND, INDEPENDENT INSTANCE. Two in-memory stores, two caches, two
 *      pools. The bug report reads "users I create disappear".
 *      -> INTERVIEW: "A provider is registered in two modules - how many
 *         instances?" Two. The instance belongs to the declaring module. One
 *         owner, exported.
 *
 *   3. Make `UsersModule` `@Global()`.
 *      Global only changes whether you must WRITE the import; it exports
 *      nothing extra. And a global feature module hides the graph for everyone.
 *
 * THE RIGHT FIX is nearly always: ask the owning module for a METHOD, not for
 * its internals. `ProjectsService` does not need the repository or the hasher;
 * it needs "does this user exist?" - so `UsersService.findById()` is the correct
 * dependency and the boundary stays intact.
 * =============================================================================
 */
/**
 * =============================================================================
 * PHASE 4: THE CIRCULAR DEPENDENCY - why it happens and how `forwardRef` works
 * =============================================================================
 * A new business rule arrived: "you may not delete a user who still owns active
 * projects." Implementing it inside `UsersService` means:
 *
 *     UsersService ──needs──> ProjectsService     (count their projects)
 *     ProjectsService ──needs──> UsersService     (validate the owner exists)
 *
 * At the module level:
 *
 *     UsersModule  ──imports──> ProjectsModule
 *     ProjectsModule ──imports──> UsersModule
 *
 * WHY THAT BREAKS WITHOUT HELP - and this is the part to be able to explain:
 * the problem is not Nest, it is JavaScript module evaluation. To evaluate
 * `users.module.ts`, Node must first evaluate its import of
 * `projects.module.ts`, which must first evaluate its import of
 * `users.module.ts` - which is mid-evaluation, so Node hands back a partially
 * initialised module object. One of the two classes is `undefined` at the
 * moment the decorator runs. Nest then sees `imports: [undefined]` and reports:
 *
 *     Nest cannot create the UsersModule instance.
 *     The module at index [0] of the UsersModule "imports" array is undefined.
 *
 * or, for the provider-level version of the same problem:
 *
 *     Nest can't resolve dependencies of the UsersService (..., ?).
 *
 * HOW `forwardRef()` FIXES IT:
 * `forwardRef(() => ProjectsModule)` wraps the reference in a FUNCTION. The
 * class is not read when the decorator executes - it is read later, when Nest
 * calls the function, by which time both files have finished evaluating. It is
 * lazy evaluation, nothing more clever than that.
 *
 * IT MUST BE ON BOTH SIDES. `forwardRef` on one module only moves the failure;
 * the pair is what breaks the evaluation cycle. Same for the provider-level
 * `@Inject(forwardRef(() => X))`.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS IS STILL A DESIGN SMELL, EVEN THOUGH IT WORKS
 * -----------------------------------------------------------------------------
 *   1. IT BREAKS MODULARITY. Neither module can now be understood, tested, or
 *      extracted alone. Phase 20's microservice split has no seam to cut here.
 *   2. IT HIDES A MISSING CONCEPT. A cycle almost always means there is a third
 *      thing neither module owns - here, "account lifecycle".
 *   3. IT IS FRAGILE. Add a third module to the cycle, or an `onModuleInit`
 *      that calls across it, and you get initialisation-order bugs that are
 *      genuinely hard to diagnose.
 *   4. IT DEFEATS `strictNullChecks` at the boundary: a forwardRef'd dependency
 *      is `undefined` for a window during bootstrap, so touching it in a
 *      CONSTRUCTOR (rather than a method) can still fail.
 *
 * THE FOUR WAYS OUT, worst to best:
 *
 *   1. `forwardRef()`               - what we do here, so you have seen it work.
 *   2. Lazy `ModuleRef.get()` in a method instead of constructor injection.
 *      Same coupling, no evaluation cycle. Slightly better, still service
 *      location.
 *   3. EXTRACT THE SHARED CONCEPT. An `AccountsModule` that imports both and
 *      owns "close this account": Users and Projects stop knowing about each
 *      other and the arrows point one way again.
 *   4. INVERT WITH AN EVENT. `UsersService` emits `user.deletion_requested`;
 *      `ProjectsModule` subscribes and vetoes or reacts. The compile-time
 *      dependency disappears entirely, and it is the same mechanism that later
 *      lets these two live in different processes.
 *
 * PHASE 13 REPLACES THIS WITH OPTION 4, and the diff is the lesson. For now,
 * the cycle exists on purpose: seeing `forwardRef` work - and then seeing it
 * deleted - is worth more than reading that you should avoid it.
 *
 * INTERVIEW ANSWER, compressed: "forwardRef defers the class reference so the
 * ES module cycle resolves. It works, but I treat a cycle as a signal that a
 * concept is missing - usually I extract the shared behaviour into a third
 * module or invert the dependency with a domain event, and reserve forwardRef
 * for cases where I cannot change the design right now."
 * =============================================================================
 */
@Module({
  /**
   * PHASE 13: THIS ARRAY USED TO CONTAIN `forwardRef(() => ProjectsModule)`.
   *
   * It is gone, along with its mirror image in `projects.module.ts`, because
   * `UsersService` now emits a domain event instead of calling
   * `ProjectsService`. The long essay above describes a cycle this module no
   * longer has - kept deliberately, because the *reasoning* is the lesson and
   * the diff between then and now is the proof.
   *
   * What is left is infrastructure only, which is what a feature module's
   * imports should look like.
   */
  imports: [
    // See projects.module.ts for the root-vs-feature explanation.
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],

  controllers: [UsersController],

  /**
   * Nest instantiates each provider once, in dependency order:
   *
   *   BcryptPasswordHasher (needs AppConfigService - found in a @Global() module)
   *   UsersRepository      (no dependencies)
   *   UsersService         (needs UsersRepository, PASSWORD_HASHER, AppConfigService)
   *
   * THE ORDER OF THIS ARRAY IS IRRELEVANT. Nest resolves by dependency graph,
   * not by array position - a frequent misconception worth testing once.
   */
  providers: [UsersService, usersRepositoryProvider, passwordHasherProvider],

  /**
   * The narrowest useful public API.
   *
   * Treat this array like a published package's exports: adding to it is a
   * commitment, removing from it is a breaking change for every importing
   * module. Review it with that in mind.
   */
  exports: [UsersService],
})
export class UsersModule {}
