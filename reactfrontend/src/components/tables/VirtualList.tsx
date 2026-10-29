import { useRef, useState, type ReactNode } from 'react';
import { Box } from '@mui/material';

/**
 * =============================================================================
 * VirtualList - windowing, in about forty lines
 * =============================================================================
 * Renders only the rows currently in view, plus a small overscan.
 *
 * THE PROBLEM IT SOLVES, with the numbers that matter: 10,000 rows is 10,000
 * DOM nodes at minimum, and usually five times that once each row has a chip, a
 * link and a button. Browsers cope badly past a few thousand elements - layout,
 * paint and memory all scale with node count, and the tab becomes unresponsive
 * on a mid-range phone long before the data is unusable.
 *
 * Windowing makes rendering cost proportional to the VIEWPORT, not the dataset.
 * 10,000 rows or 10 million, the DOM holds ~20 nodes either way.
 *
 * -----------------------------------------------------------------------------
 * WHY BUILD IT RATHER THAN INSTALL react-window
 * -----------------------------------------------------------------------------
 * FOR PRODUCTION, USE THE LIBRARY. `react-window` and `@tanstack/virtual`
 * handle variable row heights, horizontal windowing, scroll restoration, sticky
 * headers and RTL - none of which is here, and all of which is real work.
 *
 * This exists because the mechanism is worth understanding once: it is
 * arithmetic on scrollTop, not magic. Being able to explain it - and to say
 * what the libraries add - is the difference between "I used react-window" and
 * "I know when virtualization is the wrong answer".
 *
 * -----------------------------------------------------------------------------
 * WHEN VIRTUALIZATION IS THE WRONG ANSWER, which matters more
 * -----------------------------------------------------------------------------
 *   1. WHEN PAGINATION WOULD DO. Our task and project lists are paginated
 *      server-side at 20 rows. Virtualizing 20 rows is pure overhead. This
 *      component exists for the cases pagination cannot serve - a live log, an
 *      infinite feed, a picker over every user in the system.
 *
 *   2. IT BREAKS Ctrl+F. Off-screen rows are not in the DOM, so the browser
 *      cannot find them. That surprises users badly on a data-heavy screen.
 *
 *   3. IT COMPLICATES ACCESSIBILITY. A screen reader announces "list, 20 items"
 *      when there are 10,000, unless you set `aria-setsize`/`aria-posinset`
 *      yourself - which the naive implementations do not.
 *
 *   4. ANCHORS AND PRINT break: linking to a row that is not rendered, and
 *      printing a page that only contains the visible window.
 *
 * SO: paginate first. Virtualize only when the dataset must genuinely be
 * scrollable in one continuous list.
 * =============================================================================
 */

interface VirtualListProps<T> {
  items: T[];
  /**
   * FIXED ROW HEIGHT, in pixels. The simplifying assumption that makes the
   * arithmetic below trivial.
   *
   * Variable heights need measurement and a running offset cache - which is the
   * bulk of what a real virtualization library does, and the main reason to use
   * one. Getting a row's height wrong here shows up as scroll drift: the
   * content slides away from the scrollbar as you go.
   */
  rowHeight: number;
  /** Visible window height. The list scrolls inside this. */
  height: number;
  renderRow: (item: T, index: number) => ReactNode;
  /**
   * Rows rendered beyond the viewport at each end.
   *
   * WITHOUT OVERSCAN the row entering the viewport mounts in the same frame it
   * becomes visible, so fast scrolling shows blank strips - the render cannot
   * keep up with the scroll. A handful of extra rows buys the time.
   *
   * TOO MUCH overscan just re-introduces the cost virtualization removed. 3-5
   * is the usual sweet spot; 50 defeats the point.
   */
  overscan?: number;
  label: string;
}

export function VirtualList<T>({
  items,
  rowHeight,
  height,
  renderRow,
  overscan = 4,
  label,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * THE ENTIRE ALGORITHM, in three lines of arithmetic.
   *
   * `scrollTop / rowHeight` is the first row that would be visible; the window
   * is that many rows plus however many fit in `height`. `Math.max/min` clamp
   * to the array so overscan at the edges does not produce negative indices or
   * read past the end.
   */
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const lastVisible = Math.min(items.length, firstVisible + visibleCount);

  const visible = items.slice(firstVisible, lastVisible);

  return (
    <Box
      ref={containerRef}
      onScroll={(event) => {
        /**
         * READ FROM THE EVENT TARGET, and note what is NOT here: no
         * `requestAnimationFrame` throttle, and no debounce.
         *
         * Scroll fires a lot, and each fire calls setState. That sounds
         * alarming and is fine, because React 18 batches and the render is
         * ~20 rows. Throttling here would be optimising before measuring - and
         * a throttled scroll handler shows visible lag on a fast wheel.
         *
         * If the Profiler showed this was hot, the fix would be
         * `useTransition` to mark the update non-urgent, not a throttle.
         */
        setScrollTop(event.currentTarget.scrollTop);
      }}
      sx={{ height, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}
      /*
        `role="list"` plus the size hints on each row below. A virtualized list
        lies to assistive tech by default - it says "20 items" when there are
        10,000 - so the true size has to be declared explicitly.

        -------------------------------------------------------------------
        THIS USED TO CARRY `aria-rowcount={items.length}`, AND THAT WAS A BUG
        -------------------------------------------------------------------
        axe flagged it CRITICAL (aria-allowed-attr): `aria-rowcount` belongs to
        the GRID/TABLE family of roles - `table`, `grid`, `treegrid`. It is not
        valid on `role="list"` and assistive tech simply discards it.

        So the attribute that was supposed to be the fix for virtualization's
        biggest accessibility problem was doing NOTHING. The code looked
        careful. The comment next to it explained a real problem correctly. The
        implementation was inert.

        `aria-setsize` on each row is what actually carries the true size for a
        list, and it was already there - which is why removing this changes no
        behaviour at all. It only removes the false impression that a second
        mechanism was helping.

        WHY THIS IS THE MOST USEFUL FINDING IN THE WHOLE ACCESSIBILITY PASS:
        it is invisible to every other check. It typechecks (React allows any
        `aria-*`), it lints, it renders, it reviews well because the comment
        beside it is right. Nothing but a rules engine that knows the ARIA spec
        was ever going to catch it.

        INTERVIEW: "what does automated accessibility testing actually buy
        you?" - this. Not the missing alt text you would have caught anyway,
        but the ARIA that is well-intentioned, plausible and invalid.
      */
      role="list"
      aria-label={label}
    >
      {/*
        THE SPACER. A single div of the FULL height, so the scrollbar behaves as
        though every row were present. Without it the container scrolls only as
        far as the rendered rows and the illusion collapses immediately.
      */}
      <Box sx={{ height: items.length * rowHeight, position: 'relative' }}>
        {/*
          The rendered window is absolutely positioned at its true offset, so
          rows line up with the scrollbar position they claim to occupy.

          `transform: translateY` rather than `top` - it is compositor-friendly
          and avoids a layout pass on every scroll frame. A small change with a
          measurable effect on scroll smoothness.
        */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${String(firstVisible * rowHeight)}px)`,
          }}
        >
          {visible.map((item, offset) => {
            const index = firstVisible + offset;
            return (
              <Box
                key={index}
                role="listitem"
                // The true position in the FULL list, not in the window. Without
                // these a screen reader reports "item 3 of 20" while the user is
                // at row 4,000.
                aria-posinset={index + 1}
                aria-setsize={items.length}
                sx={{ height: rowHeight, display: 'flex', alignItems: 'center', px: 2 }}
              >
                {renderRow(item, index)}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
