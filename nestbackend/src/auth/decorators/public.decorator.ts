import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'taskflow:isPublic';

/**
 * =============================================================================
 * @Public() - marking a route as not requiring authentication
 * =============================================================================
 * `SetMetadata(key, value)` attaches arbitrary metadata to a class or method.
 * A guard later reads it with `Reflector`. That pair - SetMetadata to write,
 * Reflector to read - is the mechanism behind EVERY custom decorator in Nest,
 * including `@Roles()` in Phase 8. Learn it once and the rest is naming.
 *
 * WHY DENY-BY-DEFAULT?
 * The global `JwtAuthGuard` protects every route, and routes opt OUT with
 * `@Public()`. The alternative - protecting routes by adding
 * `@UseGuards(JwtAuthGuard)` to each one - is allow-by-default, and it fails in
 * the worst possible direction: the day someone adds an endpoint and forgets
 * the decorator, it is silently open to the internet. Nobody notices, because
 * it works.
 *
 * With deny-by-default, forgetting is a 401 in the first test run. Fail
 * CLOSED, not open. This is one of the highest-value five-line decisions in a
 * codebase, and it is worth stating exactly that way in an interview.
 *
 * The escape hatch is deliberately visible: `@Public()` in a diff is something
 * a reviewer will stop on, which is precisely what you want.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
