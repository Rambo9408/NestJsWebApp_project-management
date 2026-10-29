/**
 * =============================================================================
 * THE HTTP CLIENT
 * =============================================================================
 * A thin, typed wrapper over `fetch`.
 *
 * SCOPE NOTE: from Phase 9 onward, feature data goes through RTK Query, which
 * has its own `fetchBaseQuery`. This module does NOT disappear - it stays as
 * the low-level transport for the handful of calls that sit OUTSIDE the RTK
 * Query cache, and it is where the shared concerns (CSRF header, error
 * normalisation) are defined once so both paths agree.
 *
 * WHY fetch AND NOT AXIOS:
 *   fetch is built in, so it is 0kB. Axios buys three things: interceptors, a
 *   nicer error object, and automatic JSON. This file reimplements the parts we
 *   need in ~40 real lines. For a bigger app with retry policies, upload
 *   progress and request cancellation everywhere, axios earns its ~13kB.
 *   TRADE-OFF, honestly stated: axios's interceptor API is genuinely better
 *   than hand-rolling one, and if the team already knows it, "we wrote our own
 *   smaller axios" is a cost, not a win.
 *
 * ANGULAR BRIDGE: this file is `HttpClient` + one `HttpInterceptor`. The big
 * difference is that Angular INJECTS HttpClient through DI, so a test swaps the
 * implementation via the injector. React has no DI container - we import a
 * module directly, and tests intercept at the NETWORK level with MSW instead.
 * That is not a workaround; intercepting the network tests more of the real
 * stack than swapping a service class does.
 * =============================================================================
 */
import { API_BASE_URL } from '@/config/env';
import { isApiError, type ApiError } from '@/types/api';
import { tokenStore } from '@/features/auth/tokenStore';
import { refreshAccessToken } from './refreshClient';

/**
 * The CSRF cookie/header pair - backend: src/common/guards/csrf.guard.ts
 *
 * THE DOUBLE-SUBMIT COOKIE PATTERN, and why it works:
 *   The server sets a random token in a cookie that is deliberately NOT
 *   httpOnly. We read it with JavaScript and echo it back in a header. The
 *   server compares the two (with `timingSafeEqual`) and rejects a mismatch.
 *
 *   An attacker's page CAN make the browser send our cookies - that is what
 *   CSRF is. What it CANNOT do is READ our cookies, because the same-origin
 *   policy stops it. So it cannot set the matching header, and the request
 *   fails. The cookie being readable by our own JS is the entire mechanism -
 *   making it httpOnly would break the pattern, which is why the backend
 *   comments call that out explicitly.
 *
 * INTERVIEW: "if the CSRF cookie is readable by JavaScript, is that not
 * insecure?" - No, because the token is not a credential. It proves the
 * request came from a page on our origin. An XSS bug defeats it, but XSS
 * defeats every CSRF defence, which is why they are separate problems.
 */
const CSRF_COOKIE = 'taskflow_csrf';
const CSRF_HEADER = 'x-csrf-token';

function readCookie(name: string): string | undefined {
  // `document.cookie` is one flat string: "a=1; b=2". There is no getter API.
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.split('=')[1];
}

/**
 * A discriminated-union-friendly error class.
 *
 * WHY A CLASS AND NOT A PLAIN OBJECT: `instanceof HttpError` is a reliable
 * runtime check that survives being thrown through async boundaries, and it
 * carries a stack trace. The `body` field preserves the backend's structured
 * error so callers can read `statusCode` and the per-field `message` array.
 */
export class HttpError extends Error {
  /**
   * NOTE THE EXPLICIT FIELDS instead of TypeScript's PARAMETER PROPERTIES
   * (`constructor(readonly status: number)`), which would be shorter.
   *
   * WHY: `erasableSyntaxOnly` is enabled in tsconfig. Parameter properties are
   * one of the few TS features that EMIT RUNTIME CODE - the compiler generates
   * `this.status = status` for you - so they cannot be erased by a
   * type-stripping runtime (Node's native TS support, and Vite's esbuild
   * pipeline). The flag rejects exactly this syntax.
   *
   * WORTH KNOWING because it is where the NestJS and React halves of this
   * project genuinely differ. The backend uses parameter properties constantly
   * -`constructor(private readonly usersService: UsersService)` is how Nest DI
   * works at all - because it compiles with tsc and full decorator metadata.
   * The frontend is bundled by esbuild, which only strips types and never
   * transforms. Same language, different compilation model.
   *
   * INTERVIEW: "what TypeScript features emit runtime code?" - enums,
   * parameter properties, namespaces, and legacy decorators. Everything else
   * is erasable.
   */
  readonly status: number;
  readonly body: ApiError | null;

  constructor(status: number, body: ApiError | null, message: string) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = 'HttpError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Query params. Undefined/null entries are dropped rather than sent as "undefined". */
  params?: Record<string, string | number | boolean | undefined | null>;
  /**
   * Opt OUT of the refresh-and-retry behaviour.
   *
   * Needed by the auth endpoints themselves: a failed LOGIN returns 401, and
   * that 401 means "wrong password", not "your token expired". Retrying it
   * after a refresh would be nonsense - there is no session to refresh - and it
   * would turn one wrong-password attempt into two requests.
   *
   * Set internally by `authApi`; callers should not normally touch it.
   */
  skipAuthRetry?: boolean;
}

/**
 * The single request function.
 *
 * GENERIC over the response type: `request<User>(...)` returns `Promise<User>`.
 *
 * BE HONEST ABOUT WHAT THIS GENERIC IS: it is an ASSERTION, not a validation.
 * At runtime this function parses JSON and hands it back; nothing checks that
 * the server actually sent a `User`. The type is a promise we make to the
 * compiler about the contract. If the backend changes a field, this code
 * compiles and fails at runtime.
 *
 * The rigorous alternative is to parse the RESPONSE with Zod too, not just
 * form input - then the boundary is genuinely type-safe. That costs a schema
 * per endpoint and some bundle size. We revisit it in the Validation phase;
 * for now, know that the guarantee here is weaker than it looks.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, params, headers, skipAuthRetry, ...init } = options;

  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      // Skipping null/undefined matters: `String(undefined)` is the literal
      // "undefined", and the backend's ValidationPipe would reject it as an
      // invalid enum/ObjectId rather than treating the filter as absent.
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  const csrfToken = readCookie(CSRF_COOKIE);

  /**
   * The actual network call, factored out so it can be REPLAYED after a token
   * refresh without rebuilding the URL and params.
   *
   * It takes the token as an argument rather than reading `tokenStore` itself,
   * because the retry must use the NEW token - and reading the store again
   * would work only by luck of ordering. Passing it explicitly makes the retry
   * obviously correct.
   */
  const send = (token: string | null) =>
    fetch(url, {
      ...init,
    /**
     * `credentials: 'include'` is MANDATORY here.
     *
     * fetch does NOT send cookies cross-origin by default. Without this line
     * the httpOnly refresh cookie never reaches the backend and every refresh
     * returns 401 - a bug that looks like a broken auth implementation and is
     * really one missing option.
     *
     * A DETAIL FOUND BY INSPECTING THE REAL Set-Cookie HEADER, not the docs:
     * the refresh cookie is scoped `Path=/api/v1/auth`. The browser therefore
     * sends it ONLY to the auth endpoints, and never attaches it to
     * /api/v1/tasks or any other call.
     *
     * That is defence in depth worth recognising: the credential with the
     * longest life (7 days here, vs 15 minutes for the access token) is
     * exposed on the narrowest possible surface, so an injection or logging
     * mistake on a feature endpoint cannot capture it. It also means "why is
     * my refresh cookie missing?" usually has one answer - the request went to
     * a path outside that scope.
     */
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrfToken ? { [CSRF_HEADER]: csrfToken } : {}),
        /**
         * THE BEARER TOKEN. The backend's JWT strategy reads
         * `ExtractJwt.fromAuthHeaderAsBearerToken()` first, so this is the
         * primary path.
         *
         * Conditional, because unauthenticated endpoints (login, register)
         * have no token - and sending `Authorization: Bearer null` is worse
         * than sending nothing: some servers reject a malformed header
         * outright rather than treating it as absent.
         */
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let response = await send(tokenStore.get());

  /**
   * ===========================================================================
   * REFRESH AND RETRY ON 401
   * ===========================================================================
   * This is the interceptor. Angular would express it as an `HttpInterceptor`
   * with `catchError` + `switchMap`; the shape of the logic is the same.
   *
   * FOUR CONDITIONS, and each one prevents a specific bug:
   *
   *   status === 401      only an auth failure triggers a refresh. A 403 means
   *                       "authenticated but not allowed" - refreshing gives
   *                       the same user the same denial, so it would be a
   *                       wasted round-trip and a misleading retry.
   *
   *   !skipAuthRetry      the auth endpoints opt out. A failed LOGIN 401s
   *                       because the password is wrong, not because a token
   *                       expired.
   *
   *   tokenStore.get()    we only had a session to begin with. A 401 on a
   *                       request that carried no token means the user is
   *                       simply logged out - there is nothing to refresh, and
   *                       attempting it would fire a pointless request on every
   *                       anonymous page load.
   *
   *   (implicitly) ONE retry only. There is no loop here. If the replayed
   *                       request 401s again, that result is returned as-is.
   *                       A retry loop around auth is how you get an infinite
   *                       request storm against your own API.
   * ===========================================================================
   */
  if (response.status === 401 && !skipAuthRetry && tokenStore.get() !== null) {
    try {
      // Single-flight: concurrent 401s share ONE refresh. See refreshClient.
      const freshToken = await refreshAccessToken();
      response = await send(freshToken);
    } catch {
      /**
       * The refresh failed - the session is genuinely over.
       *
       * `refreshAccessToken` has already called `tokenStore.expire()`, which
       * notifies the AuthProvider and sends the user to /login. We swallow the
       * refresh error here and fall through, so the ORIGINAL 401 is what the
       * caller sees. That is the more useful error: "this request was
       * unauthorised", not "the refresh you never asked for failed".
       */
    }
  }

  // 204 No Content - the backend uses it for logout and delete. Calling
  // `.json()` on an empty body throws a SyntaxError, so this branch is not
  // defensive padding; it is required by the contract.
  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new HttpError(
      response.status,
      isApiError(payload) ? payload : null,
      isApiError(payload)
        ? [payload.message].flat().join(', ')
        : `Request failed with status ${response.status}`,
    );
  }

  return payload as T;
}

/** Verb helpers. Purely ergonomic - they all funnel into `request`. */
export const http = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
