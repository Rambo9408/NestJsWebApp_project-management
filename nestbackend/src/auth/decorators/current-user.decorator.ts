import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

import { AuthenticatedUser } from '../auth.types';

/**
 * =============================================================================
 * @CurrentUser() - a CUSTOM PARAMETER DECORATOR
 * =============================================================================
 * `createParamDecorator` builds the same kind of thing as `@Body()`, `@Param()`
 * and `@Query()` - those are not special, they are param decorators over the
 * same API.
 *
 * The factory receives `(data, context)`:
 *   `data`    - whatever was passed at the call site: @CurrentUser('id')
 *   `context` - the ExecutionContext, so it works for HTTP, WS or RPC
 *
 * WHY THIS IS BETTER THAN `@Req() req` AND READING `req.user`:
 *   - TYPE SAFETY. `req.user` is typed `any` (or `Express.User`, which is
 *     empty). This returns `AuthenticatedUser`.
 *   - INTENT. `@CurrentUser() user` says what the handler needs. `@Req()` says
 *     "give me everything", which also means the handler could touch headers,
 *     cookies or the raw socket - and now it is coupled to HTTP and hard to
 *     unit-test.
 *   - ONE PLACE TO CHANGE. If the shape of `request.user` ever changes, one
 *     file changes.
 *
 * IMPORTANT: this decorator does NOT authenticate. It only reads what a guard
 * already put there. If no guard ran, it returns `undefined` - which is exactly
 * why deny-by-default (see `@Public()`) matters: with allow-by-default, a
 * forgotten guard turns `user.id` into a TypeError at best and a security hole
 * at worst.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    // `@CurrentUser('id')` returns just that property; `@CurrentUser()` the whole object.
    return data && user ? user[data] : user;
  },
);
