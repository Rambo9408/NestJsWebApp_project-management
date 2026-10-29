import { Box, CircularProgress, Skeleton, Stack, Typography } from '@mui/material';

/**
 * =============================================================================
 * LoadingState
 * =============================================================================
 * Two variants, because "loading" is not one problem.
 *
 *   SKELETON - use when you know the SHAPE of what is coming (a list of task
 *   cards, a table). It preserves layout, so nothing jumps when the data
 *   lands, and it makes the wait feel shorter because the page looks like it is
 *   already assembling itself.
 *
 *   SPINNER - use when you do not know the shape, or the area is small.
 *
 * WHY THIS IS NOT MERELY COSMETIC: a spinner that is replaced by content of a
 * different height causes LAYOUT SHIFT. If the user has started reading or
 * reaching for a button, it moves under them - and it is measured by Core Web
 * Vitals as CLS. A skeleton that matches the real layout scores zero shift.
 *
 * INTERVIEW: "how do you handle loading states?" - a strong answer mentions
 * layout stability and perceived performance, not just "I render a spinner".
 * =============================================================================
 */

interface LoadingStateProps {
  /**
   * A UNION OF STRING LITERALS, not `variant: string`.
   *
   * Editors autocomplete it, typos are compile errors, and adding a third
   * variant later forces every `switch` over it to be updated. This is the
   * cheapest form of type safety in a component API and it costs nothing.
   */
  variant?: 'spinner' | 'skeleton';
  /** Number of skeleton rows. Ignored by the spinner variant. */
  rows?: number;
  label?: string;
}

export function LoadingState({
  variant = 'spinner',
  rows = 3,
  label = 'Loading...',
}: LoadingStateProps) {
  if (variant === 'skeleton') {
    return (
      /*
        `aria-busy` tells assistive tech this region is updating, so a screen
        reader does not announce the placeholder boxes as if they were content.

        `role="status"` IS REQUIRED HERE, and this was an axe finding, not a
        design choice. A <Stack> renders a plain <div>, which has the GENERIC
        role - and `aria-label` is PROHIBITED on generic elements
        (axe: aria-prohibited-attr, serious).

        The reasoning behind that rule is worth knowing: a name on an element
        with no role has nothing to attach to. Assistive tech is free to ignore
        it entirely, so the label silently does nothing while looking like
        accessibility work. Giving the container `role="status"` makes it a
        live region, which CAN be named - and makes it consistent with the
        spinner variant below, which announces the same way.

        THE WIDER LESSON: invalid ARIA is worse than no ARIA. No ARIA falls back
        to sensible native behaviour; invalid ARIA reads as done.
      */
      <Stack spacing={1} role="status" aria-busy="true" aria-label={label}>
        {/*
          `Array.from({ length: rows })` - the idiomatic way to render N of
          something. `new Array(rows)` alone produces a SPARSE array whose
          holes `.map()` skips entirely, so it would render nothing. A classic
          JavaScript gotcha that shows up in exactly this situation.

          The index IS the right key here: these placeholders are
          indistinguishable, stateless, and never reordered. There is no
          identity to preserve because there is no identity.
        */}
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} variant="rounded" height={72} />
        ))}
      </Stack>
    );
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, py: 6 }}>
      {/*
        `aria-hidden` ON THE SPINNER, and axe is the reason this is here.

        MUI's CircularProgress renders `role="progressbar"`, and a progressbar
        with no accessible name is a serious violation (aria-progressbar-name) -
        a screen reader announces "progress bar" and nothing else, which tells
        the user something is happening but not what.

        TWO WAYS TO FIX IT, and the choice matters:
          a) `aria-label="Loading..."` on the spinner. Passes the rule - and now
             the user hears "Loading, progress bar" AND the status text below,
             because both are in the accessibility tree saying the same thing.
          b) Hide the spinner. It is a DECORATIVE ANIMATION whose entire meaning
             is already carried by the adjacent text.

        (b) is right. The rule exists to stop a nameless control reaching the
        user, and removing it from the tree satisfies the intent rather than
        just the letter. Passing an axe rule and improving the experience are
        not automatically the same action, and choosing between them is exactly
        the judgement automation cannot do for you.

        SAFE HERE because CircularProgress is not focusable. `aria-hidden` on a
        FOCUSABLE element is its own violation - you can tab to something that
        does not exist as far as the screen reader is concerned.
      */}
      <CircularProgress size={24} aria-hidden="true" />
      {/*
        `role="status"` announces politely - it waits for the screen reader to
        finish its current sentence rather than interrupting. That is right for
        progress updates and wrong for errors, which use `role="alert"`.

        A spinner with no text is INVISIBLE to a screen-reader user. The
        animation conveys nothing to them; the text is the whole message.
      */}
      <Typography role="status" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
