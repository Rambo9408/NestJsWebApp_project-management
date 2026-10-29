import type { UseFormSetError, FieldValues, Path } from 'react-hook-form';
import { HttpError } from '@/services/httpClient';
import { apiErrorMessages } from '@/types/api';

/**
 * =============================================================================
 * MAPPING SERVER VALIDATION ERRORS ONTO FORM FIELDS
 * =============================================================================
 * THIS IS THE PAY-OFF FOR A DECISION THE BACKEND MADE IN PHASE 1.
 *
 * Nest's ValidationPipe produces ONE MESSAGE PER FAILED FIELD, and the
 * backend's exception filter deliberately preserves the ARRAY rather than
 * flattening it to a string:
 *
 *     {
 *       "success": false,
 *       "statusCode": 400,
 *       "message": [
 *         "email must be a valid email address",
 *         "name must be longer than or equal to 2 characters",
 *         "password must be at least 10 characters and contain lower case, ..."
 *       ]
 *     }
 *
 * The filter's own comment says preserving that array "is what lets a frontend
 * show one message per field". This file is that frontend.
 *
 * WITHOUT IT, the user gets one red banner at the top of the form listing three
 * problems, and has to work out which input each refers to. WITH it, each
 * message appears under its own field, exactly like a client-side error.
 *
 * -----------------------------------------------------------------------------
 * WHY WE SHOW THE SERVER'S MESSAGES AND NOT OUR OWN
 * -----------------------------------------------------------------------------
 * The Zod schemas duplicate the backend's rules, and duplicated rules drift.
 * When they drift, the SERVER IS RIGHT - it is the one that actually decides.
 *
 * So the strategy is: validate locally for instant feedback, and when the
 * server rejects anyway, display what the server said. The user is never told
 * "this is fine" by one layer and "this is invalid" by another with no
 * explanation.
 * =============================================================================
 */

/**
 * The backend's messages are conventionally `"<property> must be ..."`, because
 * class-validator interpolates `args.property` at the front. So the first word
 * identifies the field.
 *
 * THIS IS A HEURISTIC AND IT IS WORTH BEING HONEST ABOUT THAT. It relies on a
 * message-format convention rather than a machine-readable contract. It breaks
 * for a custom message that does not start with the property name, and for
 * nested paths like `address.city`.
 *
 * THE RIGOROUS FIX is for the API to return structured errors:
 *
 *     "errors": { "email": ["must be a valid email address"] }
 *
 * That is a backend change worth proposing, and "I would ask for structured
 * field errors" is a strong answer to "how do you handle server-side validation
 * in a form?". Until then, this parses the convention and falls back safely -
 * anything it cannot attribute becomes a form-level error rather than being
 * dropped.
 */
export function applyServerErrors<TFieldValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TFieldValues>,
  knownFields: readonly Path<TFieldValues>[],
): { handled: boolean; formLevel: string[] } {
  // Only a 400 carries field-level validation detail. A 401, 409 or 500 is not
  // about a specific input and must not be pinned to one.
  if (!(error instanceof HttpError) || error.status !== 400 || !error.body) {
    return { handled: false, formLevel: [] };
  }

  const messages = apiErrorMessages(error.body);
  const formLevel: string[] = [];
  let handled = false;

  for (const message of messages) {
    const [firstWord] = message.split(' ');

    /**
     * Matching against a caller-supplied whitelist of field names rather than
     * trusting the string. Calling `setError('role', ...)` for a field the form
     * does not have would attach an error to a non-existent field - RHF stores
     * it, `formState.isValid` goes false, and the form can never be submitted
     * again. A permanently un-submittable form with no visible error is a
     * genuinely nasty bug.
     */
    const field = knownFields.find((name) => name === firstWord);

    if (field) {
      setError(field, { type: 'server', message });
      handled = true;
    } else {
      // Unattributable - show it at form level rather than silently dropping
      // it. A validation error the user never sees is worse than an ugly one.
      formLevel.push(message);
    }
  }

  return { handled: handled || formLevel.length > 0, formLevel };
}
