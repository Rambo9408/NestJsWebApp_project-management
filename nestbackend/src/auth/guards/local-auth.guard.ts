import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Runs the 'local' strategy (email + password) and puts the result on
 * `request.user`.
 *
 * Used on exactly one route: `POST /auth/login`. Everything else uses the
 * global `JwtAuthGuard` - and note that login must ALSO be marked `@Public()`,
 * because otherwise the global JWT guard would demand a token from someone who
 * is trying to obtain one. Two guards on one route is normal; they are
 * answering different questions.
 */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
