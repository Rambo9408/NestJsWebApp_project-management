/**
 * =============================================================================
 * THE ACCESS TOKEN STORE - IN MEMORY, DELIBERATELY
 * =============================================================================
 * A module-level variable. Not localStorage, not sessionStorage, not a cookie
 * we control.
 *
 * -----------------------------------------------------------------------------
 * WHERE DO YOU STORE A JWT? The interview question, answered properly.
 * -----------------------------------------------------------------------------
 *                    XSS can read it?   Survives reload?   CSRF risk?
 *   localStorage           YES                 yes             no
 *   sessionStorage         YES                 tab only        no
 *   normal cookie          YES                 yes             YES
 *   httpOnly cookie        no                  yes             YES (mitigated)
 *   MEMORY (this)          only while running  NO              no
 *
 * THE SPLIT THIS PROJECT USES, which is the current consensus:
 *
 *   ACCESS TOKEN  -> memory. Short-lived (900s, confirmed from the API).
 *                    Any XSS during the page's life can use it, but it dies
 *                    with the tab and cannot be exfiltrated for later use.
 *
 *   REFRESH TOKEN -> httpOnly cookie, set by the backend, scoped to
 *                    /api/v1/auth. JavaScript cannot read it AT ALL. This is
 *                    the credential worth protecting - it mints access tokens
 *                    for 7 days.
 *
 * "But XSS can still call the API as the user!" - correct, and worth saying
 * before the interviewer does. The point is not that memory storage defeats
 * XSS; nothing does. The point is BLAST RADIUS: an attacker gets the current
 * tab's session, not a 7-day refresh token they can replay from their own
 * machine tomorrow.
 *
 * THE COST, and it is real: a full page reload loses the access token. That is
 * why `AuthProvider` calls /auth/refresh on boot - the httpOnly cookie survives
 * the reload and mints a fresh token. One extra request on load, in exchange
 * for never writing a long-lived credential somewhere script can read it.
 *
 * -----------------------------------------------------------------------------
 * WHY A MODULE VARIABLE RATHER THAN REACT STATE
 * -----------------------------------------------------------------------------
 * `httpClient` is a plain module. It cannot call a hook, so it cannot read
 * React state or Context. Every request needs the token synchronously.
 *
 * The alternative - threading the token through every call site as an argument -
 * means every component that fetches must also know about auth, which is
 * exactly the coupling this avoids.
 *
 * The Phase 3 warning about module variables ("shared by every instance") does
 * not apply: there IS only one session per page. That is what makes a singleton
 * correct here and wrong for component state.
 * =============================================================================
 */

let accessToken: string | null = null;

/**
 * Notified when the token is cleared by something other than an explicit
 * logout - i.e. a refresh attempt failed and the session is genuinely over.
 *
 * WHY A CALLBACK RATHER THAN AN IMPORT: this module must not import React or
 * the auth context. `httpClient` imports this, and the auth provider imports
 * `httpClient`; a reverse import would be a cycle. Inverting the dependency
 * with a subscription keeps the arrow pointing one way.
 *
 * This is the smallest possible event emitter, and it is enough.
 */
let onSessionExpired: (() => void) | null = null;

export const tokenStore = {
  get: (): string | null => accessToken,

  set: (token: string): void => {
    accessToken = token;
  },

  clear: (): void => {
    accessToken = null;
  },

  /**
   * Called by the refresh flow when it gives up. The provider re-renders into
   * the logged-out state and the router sends the user to /login.
   */
  expire: (): void => {
    accessToken = null;
    onSessionExpired?.();
  },

  /** Returns an unsubscribe function, so a provider can clean up on unmount. */
  onExpire: (handler: () => void): (() => void) => {
    onSessionExpired = handler;
    return () => {
      if (onSessionExpired === handler) onSessionExpired = null;
    };
  },
};
