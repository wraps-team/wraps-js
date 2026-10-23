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

// RFC 2047: an encoded-word is at most 75 characters. `=?UTF-8?B?` and `?=` leave 63 for
// base64, which is 60 characters, which encode 45 bytes.
const MAX_ENCODED_WORD_BYTES = 45;

/** True when `text` has a character outside ASCII. */
export function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

/**
 * Make `text` safe for the value of an unstructured header such as `Subject`, or for the display
 * name of an address. Header lines are ASCII (RFC 5322), so non-ASCII text becomes RFC 2047
 * encoded-words (`=?UTF-8?B?...?=`), each at most 75 characters and split between code points,
 * joined by a folding line break. ASCII text is returned as is.
 *
 * Call {@link assertNoHeaderInjection} on `text` first: the folding breaks this adds are the only
 * CRLF the result contains.
 */
export function encodeHeaderText(text: string): string {
  if (!hasNonAscii(text)) return text;

  const words: string[] = [];
  let chunk: Buffer[] = [];
  let chunkBytes = 0;
  const flush = () => {
    if (chunk.length === 0) return;
    words.push(`=?UTF-8?B?${Buffer.concat(chunk).toString('base64')}?=`);
    chunk = [];
    chunkBytes = 0;
  };
  // split between code points, so no character is cut across two words
  for (const char of text) {
    const bytes = Buffer.from(char, 'utf8');
    if (chunkBytes + bytes.length > MAX_ENCODED_WORD_BYTES) flush();
    chunk.push(bytes);
    chunkBytes += bytes.length;
  }
  flush();
  return words.join('\r\n ');
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
