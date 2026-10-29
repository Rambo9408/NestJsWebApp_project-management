import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * =============================================================================
 * A CUSTOM PIPE
 * =============================================================================
 * 1. WHAT IS A PIPE?
 * A class implementing `PipeTransform` that runs on ONE bound argument, just
 * before the handler is called. It has exactly two jobs:
 *
 *     TRANSFORM  - convert the value ("2" -> 2, plain object -> DTO instance)
 *     VALIDATE   - throw if it is unacceptable
 *
 * `transform(value, metadata)` either returns the (possibly changed) value or
 * throws. Throwing produces a 400 by default, before the controller runs.
 *
 * 2. WHERE PIPES SIT IN THE REQUEST LIFECYCLE
 *
 *     middleware -> guards -> interceptors(pre) -> PIPES -> handler
 *
 * Note pipes run AFTER guards. That ordering is deliberate and worth stating in
 * an interview: an unauthenticated caller is rejected before you spend CPU
 * validating their body, and a validation error can never leak information
 * (like which fields exist) to someone who was not allowed in.
 *
 * 3. THE FOUR SCOPES a pipe can be bound at:
 *     app.useGlobalPipes(...)      / APP_PIPE provider   - every handler
 *     @UsePipes() on a controller                        - every route in it
 *     @UsePipes() on a method                            - that route
 *     @Param('id', ParseObjectIdPipe)                    - ONE argument  <- this
 *
 * Argument-level is the tightest scope and the right one here, because the pipe
 * is about a specific parameter, not about the request.
 *
 * 4. WHY THIS PIPE EARNS ITS PLACE
 * Without it, `GET /users/not-an-id` reaches Mongoose, throws a `CastError`,
 * and surfaces as **500 Internal Server Error**. So a CLIENT's typo becomes a
 * SERVER error: your alerting fires, your error budget burns, and the dashboard
 * that says "we are broken" is lying. With it, the request never reaches the
 * service and the client gets a 400 that names the problem.
 *
 * 5. `ParseUUIDPipe` VS THIS
 * Nest ships `ParseIntPipe`, `ParseFloatPipe`, `ParseBoolPipe`, `ParseArrayPipe`,
 * `ParseUUIDPipe`, `ParseEnumPipe`, `DefaultValuePipe` and `ValidationPipe`.
 * There is no `ParseObjectIdPipe`, because MongoDB is not a Nest concern - so
 * this is the canonical "write your own" example, and it is about fifteen lines.
 * =============================================================================
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  /**
   * `metadata` tells you WHERE the value came from (`body` | `query` | `param` |
   * `custom`), the expected type, and the parameter name. We use it only to
   * produce a better message, but it is what makes a pipe reusable across
   * `@Param`, `@Query` and `@Body` - a generic pipe can behave differently
   * depending on the binding.
   */
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(
        `${metadata.data ?? 'value'} must be a valid MongoDB ObjectId (24 hex characters)`,
      );
    }

    /**
     * We return the STRING, not a `Types.ObjectId`.
     *
     * WHY: everything above the repository layer speaks in string ids - domain
     * entities, DTOs, JSON. Converting here would push a Mongoose type up
     * through the service layer and undo the isolation the repository exists to
     * provide. The repository converts at its own boundary, where it belongs.
     *
     * A pipe that returns a different TYPE than it received is perfectly legal
     * (`ParseIntPipe` does exactly that) - the point is that this one should
     * not.
     *
     * SUBTLE CORRECTNESS NOTE: `ObjectId.isValid` returns true for ANY 12-byte
     * string, so `"123456789012"` passes. That is a documented quirk of the
     * driver, not a bug here - the extra guard, if you need it, is a
     * `/^[0-9a-fA-F]{24}$/` test. Worth knowing when someone reports "my
     * validation let a bad id through".
     */
    return value;
  }
}
