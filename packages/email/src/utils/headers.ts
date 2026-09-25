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

// SESv2's MessageHeader limits (Node's raw-MIME path applies the same limits by
// convention, so custom headers behave identically on both send paths).
const MAX_HEADER_NAME_LENGTH = 126;
const MAX_HEADER_VALUE_LENGTH = 995;
const MAX_HEADER_COMBINED_LENGTH = 996;

// Sanity cap — SES documents no explicit header-count limit, but nothing
// legitimate (List-Unsubscribe, tracking headers, etc.) needs more than this.
const MAX_CUSTOM_HEADERS = 50;

// Set by SES or the SDK itself. Letting callers set these would clash with
// the real value or let a caller spoof envelope fields.
const RESERVED_HEADER_NAMES = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'subject',
  'date',
  'message-id',
  'mime-version',
  'content-type',
  'content-transfer-encoding',
  'return-path',
  'sender',
]);

function isPrintableAsciiExceptColon(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 33 && code <= 126 && code !== 58;
}

function isPrintableAscii(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 32 && code <= 126;
}

/**
 * Validate a caller-supplied custom headers map before any network call.
 * Enforces SESv2's `MessageHeader` limits (name/value charset and length),
 * rejects headers that SES or the SDK already set, and caps the header count.
 *
 * @returns The headers as an ordered array, insertion order preserved.
 * @throws {ValidationError} On the first invalid entry, with `field: 'headers'`.
 */
export function validateCustomHeaders(
  headers: Record<string, string>
): Array<{ name: string; value: string }> {
  const entries = Object.entries(headers);

  if (entries.length > MAX_CUSTOM_HEADERS) {
    throw new ValidationError(
      `No more than ${MAX_CUSTOM_HEADERS} custom headers are allowed`,
      'headers'
    );
  }

  return entries.map(([name, value]) => {
    if (!name) {
      throw new ValidationError('Header name cannot be empty', 'headers');
    }
    if (name.length > MAX_HEADER_NAME_LENGTH) {
      throw new ValidationError(
        `Header name "${name}" exceeds ${MAX_HEADER_NAME_LENGTH} characters`,
        'headers'
      );
    }
    if (![...name].every(isPrintableAsciiExceptColon)) {
      throw new ValidationError(
        `Header name "${name}" must be printable ASCII (33-126) and cannot contain ':'`,
        'headers'
      );
    }
    if (RESERVED_HEADER_NAMES.has(name.toLowerCase())) {
      throw new ValidationError(
        `"${name}" is set automatically and cannot be passed as a custom header`,
        'headers'
      );
    }
    if (value.length > MAX_HEADER_VALUE_LENGTH) {
      throw new ValidationError(
        `Header value for "${name}" exceeds ${MAX_HEADER_VALUE_LENGTH} characters`,
        'headers'
      );
    }
    if (![...value].every(isPrintableAscii)) {
      throw new ValidationError(
        `Header value for "${name}" must be printable ASCII with no CR, LF, or tab`,
        'headers'
      );
    }
    if (name.length + value.length > MAX_HEADER_COMBINED_LENGTH) {
      throw new ValidationError(
        `Header "${name}" name and value together exceed ${MAX_HEADER_COMBINED_LENGTH} characters`,
        'headers'
      );
    }
    return { name, value };
  });
}
