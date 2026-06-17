import { ValidationError } from '../errors';

/**
 * Reject a value destined for a MIME header line if it contains CR or LF.
 * Embedded newlines are the email-header-injection vector.
 */
export function assertNoHeaderInjection(value: string, field: string): void {
  if (/[\r\n]/.test(value)) {
    throw new ValidationError(`Illegal newline in header field: ${field}`, field);
  }
}

/** Same check, returns the value for inline use. */
export function sanitizeHeaderValue(value: string, field: string): string {
  assertNoHeaderInjection(value, field);
  return value;
}
