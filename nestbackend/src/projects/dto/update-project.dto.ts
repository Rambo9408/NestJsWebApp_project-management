import { PickType } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';

import { CreateProjectDto } from './create-project.dto';

/**
 * `PATCH /projects/:id` - an explicit ALLOW-LIST of generically-safe fields.
 *
 * `PickType` then `PartialType`: take only `name` and `description`, then make
 * them optional. Everything else is deliberately absent, and each omission has
 * a reason:
 *
 *   - `key` appears in task references (`WEB-142`) that people paste into chat
 *     and documents, so it is immutable by design. It is also DENORMALISED onto
 *     every task, which is only safe BECAUSE it is immutable.
 *   - `ownerId` is permission-bearing. Transferring ownership is its own
 *     operation with its own authorization rule.
 *   - `members` has dedicated endpoints; "send me the whole array" also creates
 *     a lost-update race between two concurrent editors.
 *   - `status` changes through `POST /projects/:id/archive`, so the transition
 *     can carry side effects.
 *
 * With `forbidNonWhitelisted: true`, sending any of them now returns
 * `400 property key should not exist` rather than being silently ignored -
 * which is a much better contract: an API that accepts input it does not honour
 * is worse than one that rejects it.
 */
export class UpdateProjectDto extends PartialType(
  PickType(CreateProjectDto, ['name', 'description'] as const),
) {}
