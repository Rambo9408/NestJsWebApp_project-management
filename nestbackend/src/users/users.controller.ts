import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from 'src/common/decorators/roles.decorator';
import { Paginated } from 'src/common/dto/pagination.query';
import { Role } from 'src/common/enums/role.enum';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';

import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQuery } from './dto/list-users.query';
import { SetUserRoleDto } from './dto/set-user-role.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PublicUser } from './entities/user.entity';
import { UsersService } from './users.service';

/**
 * =============================================================================
 * UsersController - AFTER Phase 6
 * =============================================================================
 *     POST   /api/v1/users
 *     GET    /api/v1/users
 *     GET    /api/v1/users/:id
 *     PATCH  /api/v1/users/:id
 *     PUT    /api/v1/users/:id/role
 *     DELETE /api/v1/users/:id
 *
 * COMPARE WITH THE PHASE 2 VERSION. Gone from this file:
 *   - six loose `@Query('x') x?: string` parameters
 *   - `buildPaginationQuery(page, limit)`
 *   - `if (role && !Object.values(Role).includes(role))  throw BadRequest...`
 *   - the same enum check repeated in `setRole`
 *
 * Every one of those is now a decorator on a DTO. The controller is back to
 * doing its actual job: bind input, call one service method, return.
 *
 * THE ANNOTATION IS NOW TRUE AT RUNTIME. In Phase 2, `@Body() dto: CreateUserDto`
 * was a compile-time fiction - the body was whatever the client sent. The global
 * `ValidationPipe` (registered via `APP_PIPE` in `app.module.ts`) constructs a
 * real DTO instance, validates it, and rejects the request before this method
 * runs.
 * =============================================================================
 */
/**
 * PHASE 8: USER ADMINISTRATION IS ADMIN-ONLY.
 *
 * The @Roles() decorator sits on the CLASS, so every route inherits it, and
 * individual routes can relax it with their own @Roles(). Declaring the
 * restrictive default at the class level and opening specific routes is the
 * same fail-closed instinct as the global JwtAuthGuard.
 *
 * NOTE WHAT MOVED OUT: users edit their own profile through PATCH /auth/me,
 * not through PATCH /users/:id. Separating "an admin managing a user" from "a
 * user editing themselves" gives each one its own DTO, its own policy and its
 * own audit trail - rather than one endpoint with an `if (isSelf || isAdmin)`
 * branch that has to be right in every future edit.
 */
@Roles(Role.ADMIN)
@ApiBearerAuth('access-token')
@ApiTags('users')
@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto): Promise<PublicUser> {
    return this.usersService.create(dto);
  }

  /**
   * `@Query()` with no argument binds the WHOLE query string to a DTO, which
   * the global pipe validates and transforms - so `page` really is a `number`
   * by the time it arrives.
   *
   * `@Headers('x-request-id')` still binds a single header. Header names are
   * case-insensitive per the HTTP spec and Node lowercases them, so always match
   * in lowercase. Phase 18 replaces this with a proper correlation id generated
   * by middleware and attached to every log line.
   */
  @Get()
  findAll(
    @Query() query: ListUsersQuery,
    @Headers('x-request-id') requestId?: string,
  ): Promise<Paginated<PublicUser>> {
    if (requestId) this.logger.debug(`Listing users (request ${requestId})`);

    return this.usersService.findAll({ search: query.search, role: query.role }, query);
  }

  /**
   * `@Param('id', ParseObjectIdPipe)` - a pipe bound to ONE ARGUMENT, the
   * tightest of the four scopes.
   *
   * Without it, `GET /users/not-an-id` reaches Mongoose, throws a CastError and
   * becomes a 500: a client's typo recorded as a server error. With it, the
   * request is rejected with 400 before any service code runs.
   *
   * Note pipes run AFTER guards, so from Phase 8 an unauthenticated caller is
   * turned away before we spend anything validating their input.
   */
  @Get(':id')
  findOne(@Param('id', ParseObjectIdPipe) id: string): Promise<PublicUser> {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<PublicUser> {
    return this.usersService.update(id, dto);
  }

  /**
   * PUT on a SUB-RESOURCE: "set this user's role to exactly this" is genuinely
   * idempotent, which is what PUT means. Modelling one meaningful state change
   * as its own sub-resource beats a generic PATCH, because it documents intent
   * and can carry its own authorization rule - Phase 8 puts `@Roles(ADMIN)` on
   * this route alone while leaving profile edits open to the owner.
   */
  @Put(':id/role')
  setRole(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SetUserRoleDto,
  ): Promise<PublicUser> {
    return this.usersService.update(id, { role: dto.role });
  }

  /** 204: success, and deliberately no body. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.usersService.remove(id);
  }
}
