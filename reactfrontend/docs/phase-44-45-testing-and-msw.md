# Phases 44 & 45 — Testing strategy and MSW

> Covers brief Parts 44 and 45. MSW had been installed since Phase 1 and unused;
> this puts it to work on the layer the existing tests deliberately skip.

---

## The headline: I found two of my own tests were vacuous

Both were found the same way — **deliberately breaking the code and checking the
suite went red.** Neither did.

### Vacuous test #1 — "retries with the NEW token"

I called it *"the most valuable test in this file"*. It wasn't testing anything.

My MSW refresh handler did this:

```ts
authState.accessTokenValid = true;   // ← the bug, in the MOCK
return HttpResponse.json({ accessToken: 'access-token-2' });
```

Resetting the flag made the **old** token start working again, so the test passed
even when the client replayed the stale one. I proved it by making the retry send
`access-token-1` — 10/10 still green.

Removing that line makes `access-token-1` permanently invalid, so the only way
past the handler is the new token. Same injected bug now fails 2 tests.

> **A mock that is too permissive makes a test that cannot fail.** Writing the
> assertion is half the job; proving it fails is the other half.

### Vacuous test #2 — "does NOT refetch after an optimistic update"

`changeTaskStatus` deliberately has no `invalidatesTags`. I added one back to
check the test caught it. It didn't.

The cause was timing, not the assertion: an invalidation-triggered refetch is
dispatched *after* the mutation promise resolves, so I was measuring a moment
before it could have happened. Adding a 50 ms wait makes it fail correctly.

> **"Assert that something did NOT happen" is the most fragile shape of test
> there is, because it passes by default.**

---

## 1. Why MSW, and what it replaces

Every test before this either stubbed `fetch` or injected a fake function. Both
are correct for *unit* tests, and both share one blind spot:

> **They never exercise the transport.**

`httpClient` builds a URL, attaches a bearer token, reads the CSRF cookie, sets
`credentials: 'include'`, retries on 401 and normalises errors. A stubbed `fetch`
skips all of it — every one of those could have been broken and the suite would
have stayed green.

MSW intercepts at the **network layer**. The code under test makes a real
`fetch`; MSW answers it. So the URL, headers, retry and error parsing all
genuinely run.

> **Angular bridge:** replaces `HttpClientTestingModule` + `HttpTestingController`.
> The philosophy differs in a way that matters — Angular's swaps the `HttpClient`
> *implementation*, so whether your interceptors run depends on how you wired the
> test. MSW leaves the stack intact and answers the socket, so "do my
> interceptors run in tests?" isn't a question.

**`onUnhandledRequest: 'error'`** is the setting worth arguing for. The default
warns and lets the request hit the real network — so a test can silently depend
on a running server, pass locally, and fail mysteriously in CI.

---

## 2. A real bug the tests found

RTK Query calls failed instantly under Vitest:

```
TypeError: Failed to parse URL from /api/v1/tasks?limit=20
```

`fetchBaseQuery` was configured with the relative `/api/v1`. A browser resolves
that against the current origin without being asked; **undici does not.**

`httpClient` had always done `new URL(path, window.location.origin)`.
`fetchBaseQuery` hadn't. **Two transports in the same app resolving URLs
differently** — invisible in production, and it meant one of them could not be
integration-tested at all.

Fixed by resolving the base URL once. `new URL(absolute, base)` returns the
absolute one unchanged, so the `VITE_API_BASE_URL` staging override still works.

---

## 3. The three layers, and what each one alone cannot catch

| Layer | Example | Catches | Blind to |
|---|---|---|---|
| **Unit** | `LoginForm.test.tsx` — injected `onLogin` | validation, submit state, the indistinguishable 401 | anything about HTTP |
| **Integration** | `httpClient.integration.test.ts` — real fetch, MSW answers | headers, retry, error parsing, single-flight | whether React uses it |
| **Flow** | `login.integration.test.tsx` — page + store + router + transport | **wiring** | real browser, real backend |

**The flow layer is the one people skip**, and it catches a specific class of bug
the other two structurally cannot: *everything works in isolation and nothing is
connected.* A form that validates perfectly and never dispatches; a store that
updates and a page that never navigates.

Proved by injection — commenting out `signIn(...)` fails the flow test and
**nothing else**.

**What it is not:** an end-to-end test. No browser, no real backend — that's
Playwright's job, in CI against a running stack. This is the cheapest test that
can still catch a wiring bug.

---

## 4. Duplicated mechanisms need duplicated tests

Coverage showed `apiSlice.ts` at **22%**, and that number was hiding something
specific.

There are **two transports**, and both implement the 401 retry — in two files, in
two styles. They deliberately share `refreshAccessToken` (one single-flight
promise across both), and nothing else. A change to one is invisible to the
other's tests.

The failure mode is the nasty one: the backend rotates refresh tokens and treats
reuse as theft, so two concurrent refreshes revoke the session family. The user
is logged out apparently at random, whenever a token expires while several
requests are in flight.

Both now have integration tests, including six concurrent 401s asserting
**exactly one** refresh — with six *distinct* cache keys, so RTK Query's own
deduplication can't be what collapses them.

---

## 5. Handlers mirror reality, including the awkward bits

Every shape was verified against the running backend in earlier phases:

- login returns `{ user, accessToken, expiresIn }` — **no** `refreshToken`
- errors are `{ success: false, statusCode, message, error, path, requestId }`
- `message` is `string | string[]` — the array is one message per failed field
- the SSE notification frame **omits** `readAt`

> A mock that returns a shape the server never sends is worse than no mock: it
> makes a suite that passes against fiction.

The `/tasks` handler **checks the `Authorization` header** and rejects the stale
token permanently. That's what makes the refresh tests meaningful — a handler
that ignored auth would pass either way.

---

## 6. Coverage: 84% statements, and what's still uncovered

```
Statements  84.06%   Branches  84.82%   Functions  76.43%
```

Deliberately **not** chasing 100%. What remains uncovered is mostly declarative
endpoint config and thin wrappers — code where a test would assert that a literal
equals itself.

**Honest remaining gaps:**

- `LoadingState` at 0% — rendered everywhere, asserted nowhere directly
- `notificationsApiSlice` optimistic `markRead` patch/rollback
- `useSession.signOut` failure path (network down during logout)
- No real-browser E2E at all

> Coverage measures which lines *ran*, not whether anything was *checked*. Both
> vacuous tests above ran their code and covered their lines while asserting
> nothing useful. **A coverage number cannot detect the failure mode that
> mattered most in this phase.**

---

## 7. Interview questions

1. **Unit, integration or E2E?** All three, for different bugs. Unit for logic,
   integration for the transport, flow for wiring, E2E for the browser.
2. **Why MSW over mocking fetch?** A stubbed fetch skips the code you wrote —
   headers, retries, error parsing. MSW makes it all run.
3. **What does `onUnhandledRequest: 'error'` buy?** It stops a test silently
   depending on a real server.
4. **How do you know a test is worth having?** Break the code and watch it fail.
   Two of mine didn't — both looked fine.
5. **Is 100% coverage the goal?** No. Coverage says a line ran, not that
   anything was asserted.
6. **How do you test optimistic updates?** Block the response and assert the
   cache moved *before* it resolves; then assert the rollback on failure.
7. **What's fragile about "assert X did not happen"?** It passes by default.
   Pair it with enough waiting, and verify it fails.

---

## 8. Exercises

1. Remove `patch.undo()` from `changeTaskStatus` and run the optimistic tests.
2. Put `authState.accessTokenValid = true` back in the refresh handler, then make
   the retry send the stale token. Watch the suite stay green.
3. Delete the 50 ms wait from "does NOT refetch" and add `invalidatesTags` back.
4. Change `onUnhandledRequest` to `'warn'`, delete a handler, and see what
   happens.
5. Comment out `signIn(...)` in `LoginPage` and find which layer catches it.
6. Revert `apiSlice`'s baseUrl to the relative path and read the undici error.

---

## Verified

```
lint ✅   typecheck ✅   build ✅
151 tests across 18 files (24 new)   coverage 84.06% statements

Bug reinjection — every new suite proven to fail when the code is wrong:
  stale token on retry      → 2 fail
  CSRF header dropped       → 1 fail
  rollback removed          → 1 fail
  invalidatesTags added     → 1 fail
  signIn not called         → 1 fail
  open-redirect guard gone  → 1 fail
```

---

## Quiz

1. Why MSW rather than stubbing `fetch`?
2. What is a vacuous test, and how do you find one?
3. A mutation does not break a test. What are the **two** possibilities?
4. Name three things a jsdom test can never verify.
5. What does `onUnhandledRequest: 'error'` buy you over `'bypass'`?
6. Why query by role and accessible name rather than by test id?
7. Your MSW handler returns a cleaner shape than the real backend. What is the
   risk?
8. Every route returns 200 from nginx. What does that prove about the pages?

<details>
<summary>Answers</summary>

1. It intercepts at the **network layer**, so the real transport runs — headers,
   status codes, retry and error parsing all genuinely execute. Stubbing `fetch`
   tests that you called a mock.
2. One that passes whether or not the code is correct. You find it by
   **reintroducing the bug** and confirming the test fails.
3. The test is **vacuous**, *or* the **mutation failed to create the bug**.
   Assuming the first once nearly led to weakening a correct test.
4. Any three of: z-order/occlusion, clipping, scroll position, whether a focus
   ring is visible — anything decided by **layout**. jsdom has no layout engine
   and no hit-testing.
5. An unmocked call **fails loudly and names the URL**, instead of the page
   rendering its error state and passing a "did it render" assertion.
6. Tests then break when the **experience** breaks rather than when the markup is
   refactored — and accessibility failures show up as test failures. A test id
   would have passed while the `Modal` had no `role="dialog"` at all.
7. You are testing a backend that does not exist. The comment `POST` handler here
   returns `author: null` **because the real one does**.
8. **Nothing.** The SPA fallback serves `index.html` for every path, including
   `/total-nonsense`. No page has been rendered.

</details>

---

**Next: Docker, nginx and CI** — the frontend has no container and the CI
pipeline still only builds the backend. That's the last structural gap before the
interview-prep material (Parts 57–60).
