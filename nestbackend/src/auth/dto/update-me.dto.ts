import { PickType } from '@nestjs/swagger';

import { CreateUserDto } from 'src/users/dto/create-user.dto';

/**
 * What a user may change about THEMSELVES.
 *
 * Deliberately narrower than UpdateUserDto (which an ADMIN uses): no role, and
 * no id. Separating "an admin managing a user" from "a user editing themselves"
 * means each gets its own DTO and its own policy, instead of one endpoint with
 * an  branch that has to stay correct through every
 * future edit.
 *
 * PickType then PartialType is not used here on purpose:  is required
 * because this endpoint exists to change it. An optional-everything PATCH that
 * can legally change nothing is a contract that says nothing.
 */
export class UpdateMeDto extends PickType(CreateUserDto, ['name'] as const) {}
