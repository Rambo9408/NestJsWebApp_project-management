import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';

import { AuthService } from '../auth.service';
import { AuthenticatedUser } from '../auth.types';

/**
 * =============================================================================
 * LocalStrategy - email + password, used by ONE endpoint
 * =============================================================================
 * `usernameField: 'email'` because passport-local defaults to a field literally
 * called `username`, and forgetting this produces a baffling
 * "Missing credentials" error with a body that clearly contains the credentials.
 *
 * WHY USE A STRATEGY FOR LOGIN AT ALL, when `AuthService.login()` could just be
 * called from the controller? Two reasons, and the second is the real one:
 *
 *   1. Consistency: every authentication mechanism ends the same way, with a
 *      user object on `request.user`.
 *   2. It moves credential handling BEFORE the handler. The controller never
 *      sees the password - by the time it runs, either the user is
 *      authenticated or the request was already rejected with 401. Fewer places
 *      that touch a plaintext password is a real security property, not a
 *      stylistic one.
 *
 * The honest counterpoint: for a single login endpoint this is more machinery
 * than calling the service. It pays off once you add API keys or OAuth.
 * =============================================================================
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email', passwordField: 'password' });
  }

  /**
   * The parameter names come from passport-local's contract, not ours - hence
   * `email` sitting in the position passport calls `username`.
   *
   * ONE message for both failure modes. See the timing-attack note in
   * `AuthService.validateCredentials`: the point of equalising the WORK is lost
   * if the RESPONSE then says "no such user".
   */
  async validate(email: string, password: string): Promise<AuthenticatedUser> {
    const user = await this.authService.validateCredentials(email, password);
    if (!user) throw new UnauthorizedException('Invalid email or password');

    return user;
  }
}
