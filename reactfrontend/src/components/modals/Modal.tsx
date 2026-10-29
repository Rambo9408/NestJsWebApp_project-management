import { Box, Divider, IconButton, Modal as MuiModal, Stack, Typography } from '@mui/material';
import { createContext, useContext, useId, type ReactNode } from 'react';

/**
 * =============================================================================
 * Modal - THE COMPOUND COMPONENT PATTERN
 * =============================================================================
 *     <Modal open={open} onClose={close} title="Delete task">
 *       <Modal.Body>Are you sure?</Modal.Body>
 *       <Modal.Footer>
 *         <Button onClick={close}>Cancel</Button>
 *         <Button onClick={confirm}>Delete</Button>
 *       </Modal.Footer>
 *     </Modal>
 *
 * -----------------------------------------------------------------------------
 * WHAT A COMPOUND COMPONENT IS, and the problem it actually solves
 * -----------------------------------------------------------------------------
 * Several components that only make sense together, sharing state implicitly
 * through Context instead of through props the caller has to thread.
 *
 * THE ALTERNATIVE IT REPLACES is the "configuration prop" modal:
 *
 *     <Modal title="..." body="..." confirmText="..." onConfirm={...}
 *            cancelText="..." showCancel hideFooter footerAlign="right" ... />
 *
 * That API works for exactly the cases you anticipated. The first time someone
 * needs a form in the body, a checkbox beside the buttons, or a third action,
 * you add another prop - and the component accumulates a permanent tax of
 * options that most callers do not use. It is the same prop-explosion failure
 * as the `TaskCard` counter-example in Phase 12, one level up.
 *
 * A compound component inverts it: the parent owns BEHAVIOUR (open state,
 * escape handling, focus, the accessible name wiring) and the caller owns
 * CONTENT. Behaviour is the part that is hard and identical everywhere; content
 * is the part that differs every time. Putting each where it belongs is the
 * whole idea.
 *
 * -----------------------------------------------------------------------------
 * WHY CONTEXT RATHER THAN `cloneElement`
 * -----------------------------------------------------------------------------
 * The older way to build this walked `children` and injected props with
 * `React.cloneElement`. It breaks the moment a child is wrapped:
 *
 *     <Modal>
 *       <div>
 *         <Modal.Footer />   <-- not a direct child, gets nothing
 *       </div>
 *     </Modal>
 *
 * Context passes through any depth, so composition keeps working. It is also
 * why `Modal.Title` can be nested inside a layout wrapper and still register
 * its id with the dialog.
 *
 * -----------------------------------------------------------------------------
 * ANGULAR BRIDGE
 * -----------------------------------------------------------------------------
 * Closest to content projection with multiple named slots -
 * `<ng-content select="[header]">`. The difference is that React's "slots" are
 * ordinary values: you can compute them, store them in a variable, or pass one
 * as a prop. Angular's are a template-compiler feature.
 *
 * INTERVIEW: "when would you NOT use a compound component?" When there is only
 * one sensible arrangement. A `<Spinner>` with `<Spinner.Icon>` and
 * `<Spinner.Label>` is ceremony - the flexibility buys nothing and every caller
 * writes three lines instead of one.
 * =============================================================================
 */

interface ModalContextValue {
  onClose: () => void;
  /** The id given to the title element, referenced by `aria-labelledby`. */
  titleId: string;
}

const ModalContext = createContext<ModalContextValue | null>(null);

/**
 * THROWS rather than returning `undefined`.
 *
 * A context hook that quietly returns nothing produces a `Modal.Footer` that
 * renders fine and whose close button does nothing - a bug that survives review,
 * survives typecheck, and is found by a user. Failing at the point of misuse
 * turns it into a five-second fix.
 */
function useModalContext(component: string): ModalContextValue {
  const context = useContext(ModalContext);
  if (context === null) {
    throw new Error(`<${component}> must be rendered inside <Modal>`);
  }
  return context;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * REQUIRED, and that is a deliberate accessibility decision.
   *
   * A dialog with no accessible name announces as "dialog" and nothing else -
   * the user is told they have been interrupted but not what for. Making it
   * optional would mean most callers omit it, so the type system enforces what
   * a lint rule cannot.
   *
   * Rendered by `Modal.Title` unless the caller supplies their own; either way
   * it is what `aria-labelledby` points at.
   */
  title: string;
  /** Hides the default title bar when the caller renders its own header. */
  hideHeader?: boolean;
  children: ReactNode;
  maxWidth?: number;
}

export function Modal({ open, onClose, title, hideHeader, children, maxWidth = 520 }: ModalProps) {
  /**
   * `useId` rather than a hand-rolled counter or a random string.
   *
   * Two modals on one page would otherwise both claim `id="modal-title"`, and
   * `aria-labelledby` would resolve to whichever came first - so one dialog
   * announces the other's name. `useId` is also SSR-safe, where
   * `Math.random()` produces a hydration mismatch.
   */
  const titleId = useId();

  return (
    /**
     * =========================================================================
     * BUILT ON MUI's <Modal>, NOT FROM SCRATCH - and that is the point
     * =========================================================================
     * Everything genuinely hard about a dialog is already solved here, and each
     * piece is something hand-rolled implementations routinely miss:
     *
     *   - a PORTAL to document.body, so a parent with `overflow: hidden` or a
     *     `transform` (which creates a containing block) cannot clip it
     *   - FOCUS TRAP while open, so Tab cannot escape to the page behind
     *   - FOCUS RESTORE to the trigger on close. This is the one almost
     *     everyone forgets, and without it a screen-reader user is dumped at
     *     the top of the document with no idea where they were
     *   - `aria-hidden` on the background, so the reader cannot browse into
     *     content it cannot reach
     *   - Escape to close, and scroll lock on the body
     *
     * Phase 18-19's axe pass is the reason this is stated so plainly: the
     * accessibility failures that matter are the ones no automated tool
     * reports, and focus management is top of that list. Reimplementing this
     * to avoid a dependency would be trading a solved problem for an unsolved
     * one.
     *
     * WHAT IS STILL OURS: the compound API, the required accessible name, and
     * the `aria-labelledby` wiring. A library gives you behaviour; the contract
     * your team codes against is still a design decision.
     * =========================================================================
     */
    <MuiModal open={open} onClose={onClose}>
      <Box
        /**
         * =====================================================================
         * `role="dialog"` AND `aria-modal` GO HERE, NOT ON <MuiModal>
         * =====================================================================
         * A BUG THE TESTS CAUGHT, and worth keeping the story attached to it.
         *
         * The first version put `aria-labelledby` on `<MuiModal>` and no role
         * anywhere. It looked right, it rendered identically, and
         * `getByRole('dialog')` found nothing.
         *
         * THE CAUSE: MUI has two components and they are not the same thing.
         * `<Dialog>` is the high-level one that sets `role="dialog"` and
         * `aria-modal` for you. `<Modal>` is the LOW-LEVEL primitive - it gives
         * you the portal, the focus trap, the backdrop and the scroll lock, and
         * it deliberately assigns NO role, because it also backs drawers,
         * popovers and lightboxes, which are not dialogs.
         *
         * So the accessible role is the caller's job here. Props on `<MuiModal>`
         * land on its root container (the backdrop wrapper), not on the panel
         * the user perceives as the dialog - which is why the label was pointing
         * at the wrong element too.
         *
         * WHY THIS IS THE INTERESTING CLASS OF BUG: nothing failed. No warning,
         * no visual difference, no type error. A sighted mouse user sees a
         * perfect dialog. A screen reader announces a generic group with no name
         * and no indication the rest of the page is inert - so the user does not
         * know they are in a dialog, does not know what it is for, and does not
         * know Escape will close it.
         *
         * It was found by a test asserting `getByRole('dialog')` and
         * `toHaveAccessibleName`, which is the argument for querying by ROLE
         * rather than by test id: a test id would have passed while the
         * accessibility was entirely absent.
         *
         * `aria-modal="true"` is the second half - it tells assistive tech the
         * content behind is unavailable, which matches what the focus trap
         * already enforces for the keyboard.
         * =====================================================================
         */
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: `min(${String(maxWidth)}px, calc(100vw - 32px))`,
          // The dialog itself scrolls when the content is tall, rather than the
          // page behind it. Without this, a long form on a short viewport has
          // its submit button permanently below the fold and unreachable.
          maxHeight: 'calc(100vh - 64px)',
          overflowY: 'auto',
          bgcolor: 'background.paper',
          borderRadius: 2,
          boxShadow: 24,
          // MUI focuses this wrapper on open; the ring adds nothing because the
          // dialog is already visually obvious, and it looks like a bug.
          outline: 'none',
        }}
      >
        <ModalContext.Provider value={{ onClose, titleId }}>
          {!hideHeader && <ModalTitle>{title}</ModalTitle>}
          {children}
        </ModalContext.Provider>
      </Box>
    </MuiModal>
  );
}

/**
 * THE CONTEXT VALUE IS NOT MEMOISED, deliberately - and this is worth knowing
 * because the usual advice says it should be.
 *
 * `useMemo` on a context value stops consumers re-rendering when the provider
 * re-renders with an equal value. Here the provider is the modal itself: if it
 * re-renders, its children are re-rendering anyway, because they are its
 * `children` prop being passed straight through. The memo would prevent nothing
 * and cost a comparison.
 *
 * The Phase 3 rule holds: memoise when you have measured, or when identity is
 * consumed by something that compares it. Neither applies here.
 */

function ModalTitle({ children }: { children: ReactNode }) {
  const { onClose, titleId } = useModalContext('Modal.Title');

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 3, py: 2 }}
        component="header"
      >
        {/*
          `component="h2"`, not the visual level.

          The dialog opens inside a page that already has an h1 (the app name)
          and an h2 (the page title). A dialog is a sibling section of the page,
          so h2 keeps the outline coherent. `variant="h6"` sets the SIZE
          independently - which is exactly why MUI separates the two, and why
          picking a heading tag for its font size is the classic mistake.
        */}
        <Typography id={titleId} variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          {children}
        </Typography>
        {/*
          An icon-only button MUST carry an accessible name; the glyph is
          `aria-hidden` because "multiplication sign" is not a useful
          announcement. Same reasoning as the theme toggle in RootLayout.
        */}
        <IconButton onClick={onClose} aria-label="Close dialog" size="small">
          <Typography aria-hidden>&#10005;</Typography>
        </IconButton>
      </Stack>
      <Divider />
    </>
  );
}

function ModalBody({ children }: { children: ReactNode }) {
  return <Box sx={{ px: 3, py: 2.5 }}>{children}</Box>;
}

function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <>
      <Divider />
      {/*
        Actions right-aligned, with the primary action LAST.

        That ordering is a platform convention on the web and on Windows
        (macOS agrees; GNOME reverses it). Consistency matters more than the
        specific choice: users click by position before they read, and a
        "Delete" button where "Cancel" usually sits causes real accidents.
      */}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', px: 3, py: 2 }}>
        {children}
      </Stack>
    </>
  );
}

/**
 * ATTACHING THE PARTS AS STATIC PROPERTIES.
 *
 * WHY: `<Modal.Footer>` signals the relationship in the markup - you can see at
 * a glance that it belongs to the modal and not to some other Footer. It also
 * keeps one import instead of four.
 *
 * THE COST, which is real and worth being able to state: `Modal.Footer` is a
 * property access, so bundlers cannot tree-shake an unused part. Every consumer
 * pays for all four. At this size that is a rounding error; for a component
 * library shipped to other teams, named exports are the better trade.
 */
Modal.Title = ModalTitle;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
