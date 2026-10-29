import { Alert, Snackbar, Stack } from '@mui/material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectToasts, toastDismissed } from './uiSlice';

/**
 * =============================================================================
 * Toaster - the single render target for the toast queue
 * =============================================================================
 * Mounted ONCE in RootLayout. Anything anywhere in the app can raise a toast by
 * dispatching `toastAdded(...)` - no props, no callbacks, no shared ancestor
 * required. That decoupling is the whole reason the queue lives in the store.
 *
 * INCLUDING FROM OUTSIDE REACT: Phase 9 adds an RTK Query middleware that
 * dispatches `toastAdded` on any rejected mutation, so every failed save gets a
 * visible error for free. Middleware cannot call a hook, which is exactly why
 * Context would not have worked for this.
 * =============================================================================
 */
export function Toaster() {
  const toasts = useAppSelector(selectToasts);
  const dispatch = useAppDispatch();

  return (
    <Stack
      spacing={1}
      sx={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        // Above MUI's modal layer, or a toast raised by an action inside a
        // dialog renders behind it and is invisible exactly when it matters.
        zIndex: (theme) => theme.zIndex.snackbar,
      }}
    >
      {toasts.map((toast) => (
        <Snackbar
          key={toast.id}
          open
          /**
           * AUTO-DISMISS, but only for non-errors - see below. 5 seconds is the
           * usual guidance: long enough to read a short sentence, short enough
           * not to linger.
           */
          autoHideDuration={toast.severity === 'error' ? null : 5000}
          onClose={(_event, reason) => {
            /**
             * IGNORE `clickaway`. By default MUI closes a Snackbar when the
             * user clicks anywhere on the page - so a toast can vanish because
             * someone clicked a button on the other side of the screen, before
             * they had a chance to read it.
             *
             * This is one of the most common MUI defaults worth overriding.
             */
            if (reason === 'clickaway') return;
            dispatch(toastDismissed(toast.id));
          }}
          /*
            Positioning is handled by the Stack above so multiple toasts stack
            rather than overlapping at the same fixed coordinates. `sx` here
            neutralises the Snackbar's own fixed positioning.
          */
          sx={{ position: 'static', transform: 'none' }}
        >
          <Alert
            severity={toast.severity}
            onClose={() => dispatch(toastDismissed(toast.id))}
            variant="filled"
            /**
             * ERRORS ARE NEVER AUTO-DISMISSED (see autoHideDuration above).
             *
             * A success message can disappear - the user saw the thing succeed.
             * An error the user missed is an error they will hit again, and
             * they now have no way to find out what went wrong. Requiring a
             * deliberate dismissal is the accessible and the humane choice, and
             * it matters most for the users who read slowly.
             *
             * MUI gives severity="error" role="alert" (announced immediately)
             * and the others role="status" (announced politely) - which is the
             * right split, and is why the severity is not merely a colour.
             */
            sx={{ minWidth: 320 }}
          >
            {toast.message}
          </Alert>
        </Snackbar>
      ))}
    </Stack>
  );
}
