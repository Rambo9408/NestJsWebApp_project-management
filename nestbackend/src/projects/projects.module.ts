import { Module, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { NotificationsModule } from 'src/notifications/notifications.module';
import { UsersModule } from 'src/users/users.module';

import { ProjectAccessGuard } from './guards/project-access.guard';
import { UserDeletionListener } from './listeners/user-deletion.listener';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { MongoProjectsRepository } from './repositories/mongo-projects.repository';
import { ProjectsRepository } from './repositories/projects.repository';
import { Project, ProjectSchema } from './schemas/project.schema';

/**
 * PHASE 5: the port is bound to the MongoDB implementation.
 *
 * This one line is the entire "swap the database" step. `ProjectsService` did
 * not change; its unit test binds the same token to the in-memory
 * implementation and needs no database at all.
 */
const projectsRepositoryProvider: Provider = {
  provide: ProjectsRepository,
  useClass: MongoProjectsRepository,
};

@Module({
  imports: [
    /**
     * `forFeature` registers MODELS for this module - it compiles the schema
     * against the connection that `DatabaseModule`'s `forRootAsync` opened, and
     * registers the result under the token `@InjectModel(Project.name)` resolves.
     *
     * Root vs feature, once more: `forRoot` opens ONE connection for the whole
     * application; `forFeature` declares which models a module uses. Calling
     * `forRoot` twice would open two pools - a real and expensive mistake.
     *
     * Keeping this next to the repository that uses it is what makes the module
     * self-contained: schema, model registration, repository and service move
     * together if this module is ever extracted (Phase 20).
     */
    MongooseModule.forFeature([{ name: Project.name, schema: ProjectSchema }]),
    UsersModule,
    NotificationsModule,
  ],
  controllers: [ProjectsController],
  /**
   * PHASE 8: ProjectAccessGuard is a PROVIDER, not just a class referenced by
   * @UseGuards. It injects Reflector and ProjectsService, so the container has
   * to build it - a guard used with @UseGuards(Class) is instantiated by Nest
   * and CAN inject, but only if its dependencies are resolvable in the module
   * where the controller lives. Registering it here makes that explicit.
   *
   * It is also EXPORTED, because TasksModule reuses it: a task inherits its
   * project permissions.
   */
  providers: [
    ProjectsService,
    projectsRepositoryProvider,
    ProjectAccessGuard,

    /**
     * PHASE 13: the listener that vetoes a user deletion.
     *
     * A listener is an ordinary provider - it is registered here and
     * @OnEvent wires it to the bus at bootstrap. Note it is NOT exported:
     * nothing calls it, the bus does.
     */
    UserDeletionListener,
  ],

  /**
   * `ProjectsService` is exported because `UsersService` needs
   * `countActiveOwnedBy()` before deleting a user - the Phase 4 cycle. The
   * repository stays private, as always.
   */
  exports: [ProjectsService, ProjectAccessGuard],
})
export class ProjectsModule {}
