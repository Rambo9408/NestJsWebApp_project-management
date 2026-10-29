import { useLocation, useNavigate } from 'react-router-dom';
import { LoginForm } from '@/features/auth/LoginForm';
import { authApi } from '@/features/auth/authApi';
import { useSession } from '@/features/auth/useSession';
import { paths } from '@/routes/paths';

/**
 * A THIN ROUTE COMPONENT. It wires the form to the API, the session and
 * navigation, and does nothing else.
 *
 * WHY THE SPLIT: `LoginForm` knows how to collect and validate credentials;
 * this page knows what happens afterwards in THIS application. Keeping them
 * apart is what lets the form be tested with a stub `onLogin` - no router, no
 * network, no provider - and reused in a modal later without dragging
 * navigation with it.
 */
/**
 * Narrows `history.state` down to a safe internal path, or null.
 *
 * TWO CHECKS, and the second is a security one:
 *
 *   1. SHAPE - is there really a `{ from: { pathname: string } }` in there?
 *   2. IS IT A LOCAL PATH? It must start with a single '/'.
 *
 * WHY (2) MATTERS - this is an OPEN REDIRECT guard. If an attacker can get a
 * value into that state (or if this ever reads from a `?next=` query param,
 * which is the far more common version of this pattern), then navigating to it
 * blindly lets them send your users to `https://evil.example/login` - a pixel
 * copy of your login page, arrived at from your real domain, after a genuine
 * logout. Users have no way to tell.
 *
 * Rejecting `//evil.example` matters too: a protocol-relative URL starts with a
 * slash and is NOT local. A naive `startsWith('/')` check passes it, which is
 * the classic bypass.
 *
 * INTERVIEW: "how do you implement redirect-after-login safely?" - allow only
 * relative paths, reject anything with a scheme or a leading `//`. It is a
 * small, well-known vulnerability class and worth being able to name.
 */
function redirectTargetFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('from' in state)) return null;

  /**
   * NO CASTS NEEDED. Modern TypeScript narrows an `in` check on an `object`
   * well enough that `state.from` is already `unknown` here rather than an
   * error - so the `as { from: unknown }` the first draft had was redundant,
   * and `no-unnecessary-type-assertion` said so.
   *
   * Worth noticing: the lint rule that removes an assertion is as valuable as
   * the one that demands narrowing. Every unnecessary `as` is noise that
   * teaches the next reader to reach for casts.
   */
  const { from } = state;
  if (typeof from !== 'object' || from === null || !('pathname' in from)) return null;

  const { pathname } = from;
  if (typeof pathname !== 'string') return null;

  // Local paths only: one leading slash, and not a protocol-relative '//host'.
  return pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : null;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useSession();

  /**
   * WHERE THE USER WAS ORIGINALLY GOING, captured by RequireAuth when it
   * redirected them here.
   *
   * WITHOUT THIS: a user opens a Slack link to /tasks/abc123, is bounced to
   * login, signs in, and lands on the dashboard - then has to find the task
   * again. Small detail, disproportionately annoying.
   *
   * NOTE `location.state` IS TYPED `any` BY REACT ROUTER, which is honest of
   * it - the value comes from a history entry and anyone can push anything
   * into it, including by hand from the console. That makes it an UNTRUSTED
   * BOUNDARY, exactly like the URL and localStorage.
   *
   * `any` also SPREADS: read a property off it and the result is `any` too,
   * silently switching off every downstream check. Our lint config catches
   * that (`no-unsafe-member-access`), which is the rule earning its keep -
   * the first draft of this file leaked `any` straight into `navigate()`.
   *
   * `redirectTargetFrom` takes `unknown` and narrows properly, so the `any`
   * stops at the boundary.
   */
  const from = redirectTargetFrom(location.state) ?? paths.dashboard;

  return (
    <LoginForm
      onLogin={authApi.login}
      onSuccess={(response) => {
        // Store the access token in memory and flip the session to
        // authenticated BEFORE navigating - otherwise RequireAuth on the
        // destination route would still see `anonymous` and bounce straight
        // back here.
        signIn(response.user, response.accessToken);

        /*
          `replace: true` so the login page is REPLACED in history rather than
          pushed onto it. Without it, a user who signs in and presses Back
          lands on the login form while authenticated - confusing, and on a
          shared machine it looks like the session leaked.
        */
        void navigate(from, { replace: true });
      }}
    />
  );
}
