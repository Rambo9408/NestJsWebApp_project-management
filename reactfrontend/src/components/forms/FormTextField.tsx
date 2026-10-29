import { TextField, type TextFieldProps } from '@mui/material';
import {
  useController,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

/**
 * =============================================================================
 * FormTextField - the bridge between React Hook Form and MUI
 * =============================================================================
 * WHY THIS FILE EXISTS AT ALL:
 *
 * RHF is fastest with UNCONTROLLED inputs - it attaches a ref and reads values
 * from the DOM, so typing causes NO re-render of the form. That is its whole
 * performance story.
 *
 * MUI's TextField is a CONTROLLED component: it owns `value` and `onChange`.
 *
 * `useController` is the official bridge. It subscribes this ONE FIELD to RHF's
 * store and hands back a controlled `field` object. The trade-off is honest:
 * this field re-renders on its own keystrokes - but only this field, not the
 * form. With `register()` and a plain `<input>`, nothing re-renders at all.
 *
 * -----------------------------------------------------------------------------
 * WHY THE WRAPPER RATHER THAN <Controller> AT EVERY CALL SITE
 * -----------------------------------------------------------------------------
 * Without it, every field in the app repeats this:
 *
 *     <Controller name="email" control={control} render={({field, fieldState}) => (
 *       <TextField {...field} error={!!fieldState.error}
 *                  helperText={fieldState.error?.message} />
 *     )} />
 *
 * Six lines, per field, and the `error`/`helperText` wiring is exactly the part
 * people forget - so validation messages silently do not render on the one
 * field somebody added in a hurry.
 *
 * Centralising it means ACCESSIBILITY IS NOT OPTIONAL EITHER. MUI links the
 * helper text to the input with `aria-describedby` and sets `aria-invalid` when
 * `error` is true - but only if you pass those props. Here every field gets
 * them by construction.
 *
 * ANGULAR BRIDGE: this is a `ControlValueAccessor`. Same job - teach a
 * component to talk to the form library - with far less ceremony.
 * =============================================================================
 */

/**
 * GENERIC OVER THE FORM'S VALUES, which is what makes `name` type-safe.
 *
 *   TFieldValues  the form's value type, e.g. RegisterFormValues
 *   TName         a valid path INTO that type
 *
 * `FieldPath<TFieldValues>` is RHF's template-literal type that produces every
 * legal dotted path - 'email', 'address.city', 'items.0.title'. So:
 *
 *     <FormTextField control={control} name="emial" />   // compile error
 *
 * Without the generics, `name: string` would accept any typo and fail silently
 * at runtime: the field would render, accept input, and submit nothing.
 *
 * This is the single best argument for RHF + TypeScript over hand-rolled form
 * state, and it is worth demonstrating in an interview.
 */
interface FormTextFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> extends Omit<TextFieldProps, 'name' | 'value' | 'onChange' | 'onBlur' | 'error' | 'ref'> {
  control: Control<TFieldValues>;
  name: TName;
}

export function FormTextField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({ control, name, helperText, ...textFieldProps }: FormTextFieldProps<TFieldValues, TName>) {
  const { field, fieldState } = useController({ control, name });

  return (
    <TextField
      {...field}
      {...textFieldProps}
      /**
       * `field` spreads value, onChange, onBlur, name and ref.
       *
       * `onBlur` is the one people drop, and it matters: RHF uses blur to mark
       * a field TOUCHED. With the default `mode: 'onTouched'`, a field that is
       * never blurred is never validated on change - so the form appears to
       * ignore validation entirely until submit.
       */
      error={Boolean(fieldState.error)}
      /**
       * `helperText` does double duty: the error when there is one, the hint
       * otherwise.
       *
       * A SUBTLE LAYOUT POINT - passing `undefined` when there is neither
       * removes the element, so the field grows and shrinks as errors appear
       * and everything below it jumps. Rendering a space (or `min-height` on
       * the helper) reserves the room. Callers here always pass a hint for
       * fields that can fail, which sidesteps it.
       */
      helperText={fieldState.error?.message ?? helperText}
      /**
       * `aria-invalid` explicitly, even though MUI derives it from `error`.
       * Being explicit means a future refactor that changes how `error` is
       * styled cannot silently drop the announcement to screen readers.
       */
      aria-invalid={Boolean(fieldState.error)}
      fullWidth
    />
  );
}
