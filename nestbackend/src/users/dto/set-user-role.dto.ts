import { IsEnum } from 'class-validator';

import { Role } from 'src/common/enums/role.enum';

/**
 * The body for `PUT /users/:id/role`.
 *
 * A dedicated single-field DTO looks like overkill next to reusing
 * `UpdateUserDto`, and it is the right call: the endpoint's contract is
 * "replace the role, nothing else". Reusing a broad DTO would let a caller send
 * `{ role, email }` to an endpoint that silently ignores the email - and with
 * `forbidNonWhitelisted: true`, this narrow DTO turns that mistake into an
 * explicit 400 instead of a silent no-op.
 */
export class SetUserRoleDto {
  @IsEnum(Role)
  role: Role;
}
