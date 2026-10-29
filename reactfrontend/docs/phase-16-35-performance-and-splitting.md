# Phases 16 & 35 — Performance and code splitting

> Covers brief Parts 33, 34, 35. Measured before changing anything, and the
> measurements did **not** say what I expected.

---

## 1. What's actually in the bundle

`rollup-plugin-visualizer` with `template: 'raw-data'`, parsed for per-package
gzip totals:

```
   147 kB   29.4%  @mui/material
    85 kB   17.0%  react-dom
    48 kB    9.6%  src (our code)
    46 kB    9.2%  react-router
    28 kB    5.6%  @mui/system
    27 kB    5.4%  @reduxjs/toolkit
    25 kB    5.0%  zod
    20 kB    4.1%  @popperjs/core       ← pulled in by MUI Menu/Tooltip
    17 kB    3.4%  react-hook-form
    13 kB    2.5%  @mui/utils
```

**MUI + system + utils + popper + emotion ≈ 210 kB gzip — 44% of the bundle.**
Our own code is 48 kB.

> **The most consequential performance decision in this project was made in
> Phase 1**, when I chose MUI. No amount of later tuning moves a number like
> that; only replacing the library would.

---

## 2. The measurement that contradicted the plan

Four configurations, measured identically (sum of gzip for every module
`index.html` loads eagerly):

| Config | Eager gzip | vs baseline |
|---|---|---|
| **A** — baseline (labs lazy only) | **213 kB** | — |
| **B** — vendor chunks only | ~257 kB | **+44 kB** |
| **C** — route lazy-loading only | 236 kB | **+23 kB** |
| **D** — both | 245 kB | **+32 kB** |

**Every form of splitting made the cold first load worse.**

The reason is unglamorous: **separate gzip streams share no compression
dictionary.** One 686 kB file compresses to 212 kB; the same bytes across six
files compress to ~245 kB. Splitting redistributes and adds overhead — it does
not remove code.

This is the sort of thing that gets asserted confidently in interviews ("I code-
split to reduce bundle size") and is only sometimes true.

### So why keep config D?

Because cold-load size is not the only metric:

| Scenario | Baseline | Config D |
|---|---|---|
| First visit | 213 kB | 245 kB (**+15%**) |
| Return visit, after an app deploy | **213 kB** | **8.5 kB** (**−96%**) |
| Return visit, no deploy | 0 (cached) | 0 (cached) |

The app chunk is now **8.5 kB**. Shipping a one-line fix invalidates 8 kB
instead of 213 kB, because React, MUI, Redux and Router sit in separately-hashed
chunks that don't change.

**For an internal tool used daily by the same people, that trade is
overwhelming. For a marketing site with mostly first-time visitors, config A
wins.** The right answer depends on traffic shape, and I can only justify it
because I measured both.

### The chunk layout

```
vendor-mui      98.58 kB gzip   changes a few times a year
vendor-react    56.35 kB        changes rarely
vendor          34.14 kB        zod, RHF, misc
vendor-router   30.56 kB
vendor-redux    23.36 kB
index            8.51 kB        changes every deploy
```

Route chunks (0.3–3 kB each) load on navigation.

**Order matters in `manualChunks`:** `@mui/*` must be tested before the `react`
check, or MUI's paths get swept into the react chunk.

**Don't split per package.** Three or four coherent groups is the sweet spot —
more chunks means more requests, near-free on HTTP/2 and competing for the
six-connection budget on HTTP/1.1.

---

## 3. Virtualization — and when it's the wrong answer

`VirtualList` is ~40 lines and no dependency, because the mechanism is
arithmetic on `scrollTop`, not magic:

```ts
const firstVisible = Math.floor(scrollTop / rowHeight) - overscan;
const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
```

A full-height spacer keeps the scrollbar honest; the rendered window is
`translateY`'d to its true offset (compositor-friendly, no layout pass per
frame).

**10,000 rows → ~20 DOM nodes.** The lab has a toggle and a paint-time readout.

### For production, use the library

`react-window` / `@tanstack/virtual` handle variable row heights, horizontal
windowing, scroll restoration and sticky headers — none of which is here.
Variable heights alone need a measurement cache and are most of what those
libraries are.

### When NOT to virtualize — the more useful half

1. **When pagination would do.** Our task and project lists are paginated
   server-side at 20 rows. Virtualizing 20 rows is pure overhead.
2. **Ctrl+F stops working.** Off-screen rows aren't in the DOM.
3. **Screen readers get lied to** — "list, 20 items" when there are 10,000,
   unless you set `aria-setsize`/`aria-posinset` yourself. (This one does.)
4. **Anchors and printing break.**

> **Paginate first. Virtualize only when the data must genuinely scroll as one
> continuous list** — a live log, an infinite feed, a picker over every user.

---

## 4. `useMemo` where it actually pays

The lab pairs a 2M-iteration computation with an *unrelated* text input.

> `useMemo` isn't about making the expensive thing fast. It's about **not
> redoing it when something unrelated changed.**

That distinction is what people miss when they memoise `a + b`.

**Two separate reasons to memoise, and conflating them is why so much code is
uselessly memoised:**

- **For cost** — the computation is genuinely expensive
- **For identity** — the reference must stay stable for a memoised child, an
  effect dependency, or a context value

`createTheme` in `AppProviders` is memoised for *identity*. This lab's loop is
memoised for *cost*.

---

## 5. How to debug a slow React app

The order that finds problems fastest:

1. **Profiler first, always.** React DevTools → record → interact → read commit
   times and "why did this render?". Optimising without this is guessing.
2. **Is it renders or is it the DOM?** A re-render that produces identical output
   costs almost nothing — reconciliation skips the DOM. Chrome's Performance tab
   separates scripting from layout/paint.
3. **Is it one component or all of them?** One slow component → memoise or split
   the work. Everything re-rendering → an unstable context value or a selector
   returning a new object.
4. **Is it the network, not React?** A 200 ms "slow render" is often a 190 ms
   request. Check the waterfall before touching components.
5. **Only then** reach for `memo` / `useMemo` / `useCallback` / virtualization.

**Common causes, in rough order of frequency:** a selector or context value
returning a new object each render; an unmemoised callback passed to a memoised
child; deriving state in an effect instead of during render; rendering thousands
of rows; a heavy computation with no memo.

---

## 6. Interview questions

1. **Does code splitting reduce bundle size?** No — it redistributes it, and
   costs gzip efficiency. The wins are caching and deferring unused code.
2. **Where do you split?** Routes, heavy deps behind interactions, rarely-opened
   dialogs. Not tiny components.
3. **Why manual vendor chunks?** Cache stability. Library code changes yearly,
   app code daily; separate hashes mean a deploy invalidates only the app chunk.
4. **When do you virtualize?** When the list must scroll as one and can't be
   paginated. Volunteer the Ctrl+F and screen-reader costs.
5. **When is `useMemo` wrong?** When the computation is cheaper than the
   dependency comparison, and there's no identity requirement.
6. **How do you debug a slow app?** Profiler first. Distinguish render cost from
   DOM cost from network. Fix the cause, not the symptom.
7. **What's the biggest performance decision in a React app?** Usually the
   dependency choices made on day one. Here, MUI is 44% of the bundle.

---

## 7. Exercises

1. Run the analyser (`npm run build`, then the script in the docs) and find the
   three largest packages. Ask whether each earns its size.
2. Toggle the perf lab to "naive" with DevTools > Elements open. Watch the node
   count, then try scrolling.
3. Remove `overscan` (set it to 0) and scroll fast. Explain the blank strips.
4. Remove `useMemo` from the computation demo and type in the text box.
5. Reorder `manualChunks` so the `react` test comes before `@mui`. Rebuild and
   find MUI in the wrong chunk.
6. Set `manualChunks` to split every package separately. Count the requests and
   the total gzip.

---

## Verified

```
lint ✅   typecheck ✅   127/127 tests ✅   build ✅

Measured (eager gzip, identical method):
  baseline 213 kB · vendor-chunks 257 kB · route-lazy 236 kB · both 245 kB
  app chunk after splitting: 8.5 kB (was 213 kB)

Routes: /lab/performance /projects /tasks /admin/users /login → 200
```

---

## What I did NOT do

- **No `React.memo` sweep.** Nothing profiled as slow. Adding memo everywhere
  costs comparisons and stale-closure risk for no measured gain.
- **No MUI replacement.** It's 44% of the bundle and the obvious lever, but
  swapping a component library mid-project is a rewrite, not an optimisation.
- **No `useTransition` / `Suspense` data fetching.** Worth a phase of its own.
- **No real-device testing.** Every number here is a desktop build measurement.
  Throttled CPU and 3G numbers would likely change which trade-offs look right.

---

## Quiz

1. Code splitting made cold load **worse** here. By how much, and why?
2. So why was it kept?
3. What is the SPA caching contract, and what happens if you invert it?
4. Name two things that silently defeat `React.memo`.
5. When is virtualization the wrong answer?
6. Does "re-render" mean "touch the DOM"?
7. Why is the bundle visualiser opt-in rather than part of every build?
8. What is a bundle budget for, given the number is arbitrary?

<details>
<summary>Answers</summary>

1. **213 → 245 kB gzip.** Separate gzip streams share no dictionary, so
   compression is worse across many small files than one large one.
2. **Cache stability.** An app-only redeploy costs a returning user ~8.5 kB
   instead of ~213 kB. It is a traffic-shape trade-off, not a win.
3. Content-hashed assets `immutable` for a year; `index.html` never cached.
   Invert it and a returning user loads yesterday's HTML pointing at chunk hashes
   that no longer exist — **a blank page after every deploy**.
4. Any two of: an inline object, an inline array, an arrow function prop. All
   create a new reference every render.
5. When **pagination would do** — and it usually would. It also breaks Ctrl+F,
   anchors and printing, and needs explicit `aria-setsize`/`aria-posinset` work.
6. **No.** It means React called your function and diffed the result. If nothing
   changed, no DOM is written.
7. It writes into `dist/`, which is exactly what the Dockerfile copies into
   nginx — the full module graph was being **served in production**.
8. **Noticing.** Without one, a dependency that doubles the bundle is discovered
   six months later.

</details>

---

**Next: Phase 44/45 — testing strategy with MSW**, then Docker, nginx and CI.
