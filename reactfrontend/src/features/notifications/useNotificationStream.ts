import { useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectIsAuthenticated } from '@/features/auth/authSlice';
import { tokenStore } from '@/features/auth/tokenStore';
import { refreshAccessToken } from '@/services/refreshClient';
import { API_BASE_URL } from '@/config/env';
import { toastAdded } from '@/features/ui/uiSlice';
import { notificationsApiSlice } from './notificationsApiSlice';
import { notificationFromEvent, type NotificationEvent } from '@/types/api';

/**
 * =============================================================================
 * useNotificationStream - Server-Sent Events, done properly
 * =============================================================================
 * Subscribes to GET /api/v1/notifications/stream and pushes arriving
 * notifications straight into the RTK Query cache, so the bell badge and the
 * dropdown update with no polling and no refetch.
 *
 * -----------------------------------------------------------------------------
 * SSE vs WEBSOCKETS vs POLLING - the decision, not the trivia
 * -----------------------------------------------------------------------------
 *                    SSE                  WebSocket           Polling
 *   Direction        server -> client     bidirectional       client pulls
 *   Protocol         plain HTTP           upgrade to ws://    plain HTTP
 *   Reconnection     AUTOMATIC            you write it        n/a
 *   Proxies          works (it is HTTP)   often blocked       works
 *   Auth             awkward - see below  handshake payload   normal headers
 *   Latency          instant              instant             up to the interval
 *   Cost at rest     1 open connection    1 open connection   a request per tick
 *
 * NOTIFICATIONS ARE ONE-WAY, so SSE is the right default: less code, survives
 * corporate proxies, and the browser reconnects for you with backoff - which is
 * the part people underestimate, because reconnection is where hand-rolled
 * WebSocket clients go wrong.
 *
 * REACH FOR WEBSOCKETS when the client must send a stream too: chat, presence,
 * collaborative editing, live cursors.
 *
 * THE ONE REAL SSE GOTCHA is the HTTP/1.1 six-connection-per-origin limit. An
 * open stream holds one; open a few tabs and the app stops loading images.
 * HTTP/2 removes it entirely, which in practice means "make sure production is
 * HTTP/2".
 * =============================================================================
 */

/**
 * =============================================================================
 * !! THE TOKEN GOES IN THE URL, AND THAT IS A REAL TRADE-OFF !!
 * =============================================================================
 * `EventSource` CANNOT SET HEADERS. There is no options argument for them - the
 * API predates the concerns it would need to address. So `Authorization: Bearer`
 * is simply unavailable.
 *
 * The backend anticipated this. Its JWT strategy reads:
 *
 *     ExtractJwt.fromExtractors([
 *       ExtractJwt.fromAuthHeaderAsBearerToken(),
 *       ExtractJwt.fromUrlQueryParameter('access_token'),   <- for EventSource
 *     ])
 *
 * WHAT PUTTING A TOKEN IN A URL ACTUALLY COSTS, stated honestly:
 *   - it lands in SERVER ACCESS LOGS, and log aggregation ships it onwards
 *   - it lands in PROXY and CDN logs you may not control
 *   - it can leak via the `Referer` header on outbound links
 *   - it is visible in browser history and in a screen-shared address bar
 *
 * WHY IT IS ACCEPTABLE HERE, and the reasoning is what matters:
 *   - the ACCESS token lasts 900 seconds, so a leaked one has a short life
 *   - the REFRESH token - the credential worth stealing - stays in an httpOnly
 *     cookie and is never in a URL
 *   - the alternative designs are worse for this app: a separate short-lived
 *     stream ticket is more moving parts, and a WebSocket handshake means
 *     abandoning SSE for a one-way feed
 *
 * THE MITIGATION WORTH KNOWING: issue a single-use, 30-second STREAM TICKET from
 * a normal authenticated POST, and put THAT in the URL instead of the access
 * token. Same mechanism, much smaller blast radius. That is the answer to give
 * when an interviewer pushes on this.
 * =============================================================================
 */

interface StreamState {
  /** True while a connection is open. Drives the "live" dot in the UI. */
  connected: boolean;
  /** How many times we have had to reconnect. Useful in the UI and in tests. */
  reconnects: number;
}

export function useNotificationStream(): StreamState {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);

  const [state, setState] = useState<StreamState>({ connected: false, reconnects: 0 });

  /**
   * SEEN IDS, in a ref rather than state.
   *
   * DUPLICATES ARE NOT HYPOTHETICAL with SSE. The protocol has a `Last-Event-ID`
   * mechanism: on reconnect the browser sends the last id it saw, and a server
   * may replay from there. Our backend does not replay today - but a reconnect
   * racing an optimistic cache insert can still deliver the same notification
   * twice, and a duplicate in a notification list is very visible.
   *
   * A REF, not state, because writing to it must NOT re-render - it is
   * bookkeeping the UI never displays. Exactly the Phase 3 rule: if changing it
   * should not update the screen, it is a ref.
   */
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    /**
     * No session, no stream. Opening one anonymously would 401 immediately and
     * then retry forever - a request every few seconds for nothing.
     *
     * NOTE THERE IS NO `setState` HERE. The obvious first draft resets the
     * state on the way out, and `react-hooks/set-state-in-effect` rejects it:
     * a synchronous setState in an effect body means render, commit, paint,
     * then immediately render again.
     *
     * The fix is to DERIVE the disconnected state at the return statement
     * instead of storing it - Phase 2's rule, applied to a hook: if you can
     * calculate it, calculate it.
     */
    if (!isAuthenticated) return;

    /**
     * `cancelled` guards every async continuation below.
     *
     * StrictMode runs this effect twice in development, and the connect path is
     * async (it may await a token refresh). Without the guard the first,
     * discarded run could open a second EventSource after cleanup - a leaked
     * connection that eats one of the six per-origin slots and delivers
     * duplicate events for the life of the page.
     */
    let cancelled = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connect = () => {
      const token = tokenStore.get();
      if (!token || cancelled) return;

      /**
       * `encodeURIComponent` on the token. A JWT is base64url and contains no
       * characters that need escaping today - but building a URL by
       * concatenation without encoding is a habit that produces an injection
       * the one time the value is not what you assumed.
       */
      const url = `${API_BASE_URL}/notifications/stream?access_token=${encodeURIComponent(token)}`;

      source = new EventSource(url, {
        /**
         * `withCredentials` so cookies ride along. Not strictly needed for auth
         * here (the token is in the query), but the CSRF cookie is used by the
         * same origin and the backend's CORS is configured with
         * `credentials: true`.
         */
        withCredentials: true,
      });

      source.onopen = () => {
        if (cancelled) return;
        // A successful open RESETS the backoff. Without this, a connection that
        // survives an hour and then drops would immediately wait 30 seconds
        // before retrying, because `attempt` was never cleared.
        attempt = 0;
        setState((previous) => ({ ...previous, connected: true }));
      };

      /**
       * `addEventListener('notification')` rather than `onmessage`.
       *
       * The backend sets `type: 'notification'` on real events and `type:
       * 'ping'` on the 30-second heartbeat. `onmessage` only fires for events
       * with NO event field, so listening to the named event means the
       * heartbeat is ignored for free - no parsing, no filtering, no branch.
       *
       * That is why the backend bothers to name them, and it is worth noticing
       * that the client half of that decision is one line.
       */
      source.addEventListener('notification', (event: MessageEvent<string>) => {
        if (cancelled) return;

        let notification;
        try {
          /**
           * PARSED AS A , THEN NORMALISED.
           *
           * The stream frame is a NARROWER type than the REST endpoints return -
           * it carries no . Parsing it directly as a 
           * gives , and every unread check in the app is
           *  - so a brand-new notification rendered as already
           * read and could not be clicked to mark read, while the badge counted
           * it. Found by capturing a real frame, not by reading the interface.
           */
          notification = notificationFromEvent(JSON.parse(event.data) as NotificationEvent);
        } catch {
          /**
           * A malformed frame must not kill the stream. `EventSource` will keep
           * delivering; throwing here would surface as an unhandled error and
           * tell the user nothing useful.
           */
          return;
        }

        // DEDUPE. See the note on `seenIds` - a reconnect can replay.
        if (seenIds.current.has(notification.id)) return;
        seenIds.current.add(notification.id);

        /**
         * =====================================================================
         * PUSH INTO THE CACHE RATHER THAN INVALIDATING
         * =====================================================================
         * `invalidateTags(['Notification'])` would also work and is one line.
         * It would also fire TWO requests per arriving notification - the list
         * and the count - which on a busy project is a lot of traffic caused by
         * data we already hold in our hands.
         *
         * The event payload IS the notification. Writing it straight into the
         * cache is a local operation with no network at all.
         *
         * THE TRADE-OFF: a hand-patched cache can drift from the server. It is
         * acceptable here because the patch is an INSERT of a complete object
         * rather than a computed guess, and because the next natural refetch
         * (focus, navigation) reconciles anything missed.
         * =====================================================================
         */
        dispatch(
          notificationsApiSlice.util.updateQueryData(
            'getNotifications',
            { limit: 20 },
            (draft) => {
              // Newest first, matching the backend's `sort({ createdAt: -1 })`.
              draft.items.unshift(notification);
              draft.total += 1;
            },
          ),
        );

        dispatch(
          notificationsApiSlice.util.updateQueryData('getUnreadCount', undefined, (draft) => {
            draft.unread += 1;
          }),
        );

        // A toast, so a notification arriving while the user is on another page
        // is not silently added to a badge they are not looking at.
        dispatch(toastAdded(notification.title, 'info'));
      });

      /**
       * =======================================================================
       * onerror - where naive SSE implementations go wrong
       * =======================================================================
       * `EventSource` reconnects AUTOMATICALLY, which sounds like a feature and
       * is a trap in an authenticated app:
       *
       *   The access token expires (900s). The connection drops. The browser
       *   reconnects to the SAME URL - which still carries the EXPIRED token in
       *   the query string. It 401s. The browser reconnects again. Forever.
       *
       * The URL was fixed at construction time, so the built-in reconnect can
       * never pick up a fresh token. That is the bug, and it only appears
       * fifteen minutes into a session - long after anyone testing manually has
       * moved on.
       *
       * SO WE TAKE OVER: close the socket, get a fresh token (reusing the
       * single-flight refresh from Phase 7), and build a NEW EventSource with a
       * new URL.
       * =======================================================================
       */
      source.onerror = () => {
        if (cancelled) return;

        source?.close();
        source = null;
        setState((previous) => ({ ...previous, connected: false }));

        /**
         * EXPONENTIAL BACKOFF WITH A CEILING: 1s, 2s, 4s, 8s, 16s, then 30s.
         *
         * A fixed 1-second retry against a backend that is down is a
         * self-inflicted denial of service - every client in a loop, hammering
         * a server that is already struggling. The ceiling matters as much as
         * the growth: without one, an overnight outage would leave clients
         * retrying once an hour and the app would appear dead long after the
         * server recovered.
         *
         * A production implementation adds JITTER - a random fraction of the
         * delay - so a thousand clients that dropped together do not all
         * reconnect on the same second. Omitted here for clarity; worth naming.
         */
        attempt += 1;
        const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);

        setState((previous) => ({ ...previous, reconnects: previous.reconnects + 1 }));

        retryTimer = setTimeout(() => {
          if (cancelled) return;

          /**
           * REFRESH FIRST, THEN RECONNECT. If the drop was caused by an expired
           * token, reconnecting with the same one fails identically.
           *
           * `refreshAccessToken` is the single-flight promise from Phase 7, so
           * a stream reconnect happening at the same moment as six 401'd
           * queries still produces ONE refresh request - not seven, and not a
           * token-reuse revocation.
           *
           * On failure it has already called `tokenStore.expire()`, which
           * flips the store to anonymous; `isAuthenticated` goes false and this
           * effect tears down rather than looping.
           */
          void refreshAccessToken()
            .then(() => {
              if (!cancelled) connect();
            })
            .catch(() => {
              // Session is over. The effect's dependency on `isAuthenticated`
              // handles the teardown; nothing to do here.
            });
        }, delay);
      };
    };

    connect();

    /**
     * CLEANUP - and for a long-lived connection this is not optional.
     *
     * Without it, every navigation that unmounts this hook leaves an open
     * connection behind. Six of those and the browser refuses to load anything
     * else from the origin, which presents as "images stopped loading" rather
     * than anything pointing at SSE.
     */
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      source?.close();
    };
  }, [isAuthenticated, dispatch]);

  /**
   * DERIVED, not stored. Signing out must report "disconnected" immediately,
   * and doing that with a `setState` in the effect costs an extra render for a
   * value that is a pure function of `isAuthenticated` and `state`.
   *
   * It also removes a whole class of bug: there is no way for the stored state
   * to disagree with the session, because there is nothing stored to disagree.
   */
  return isAuthenticated ? state : { connected: false, reconnects: 0 };
}
