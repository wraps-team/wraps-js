import { safeParse, email as zEmail } from 'zod/mini';
import { ValidationError } from '../errors';
import type { EmailAddress, SendEmailParams } from '../types';
import { assertNoHeaderInjection } from './headers';

/**
 * Normalize email address to string format
 */
export function normalizeEmailAddress(address: string | EmailAddress): string {
  if (typeof address === 'string') {
    return address;
  }

  if (address.name) {
    return `"${address.name}" <${address.email}>`;
  }

  return address.email;
}

/**
 * Normalize array of email addresses to string array
 */
export function normalizeEmailAddresses(
  addresses: string | string[] | EmailAddress | EmailAddress[] | (string | EmailAddress)[]
): string[] {
  const addressArray = Array.isArray(addresses) ? addresses : [addresses];
  return addressArray.map(normalizeEmailAddress);
}

/**
 * Validate email parameters
 */
export function validateEmailParams(params: SendEmailParams): void {
  // Validate required fields
  if (!params.from) {
    throw new ValidationError('Missing required field: from', 'from');
  }

  if (!params.to) {
    throw new ValidationError('Missing required field: to', 'to');
  }

  if (!params.subject) {
    throw new ValidationError('Missing required field: subject', 'subject');
  }

  // Validate that either html or react is provided (but not both)
  if (!params.html && !params.react && !params.text) {
    throw new ValidationError('Must provide at least one of: html, text, or react', 'html');
  }

  if (params.html && params.react) {
    throw new ValidationError('Cannot provide both "html" and "react" parameters', 'html');
  }

  // Validate email addresses (basic validation)
  validateEmailAddress(params.from, 'from');

  const toAddresses = Array.isArray(params.to) ? params.to : [params.to];
  for (const [idx, addr] of toAddresses.entries()) {
    validateEmailAddress(addr, `to[${idx}]`);
  }

  if (params.cc) {
    const ccAddresses = Array.isArray(params.cc) ? params.cc : [params.cc];
    for (const [idx, addr] of ccAddresses.entries()) {
      validateEmailAddress(addr, `cc[${idx}]`);
    }
  }

  if (params.bcc) {
    const bccAddresses = Array.isArray(params.bcc) ? params.bcc : [params.bcc];
    for (const [idx, addr] of bccAddresses.entries()) {
      validateEmailAddress(addr, `bcc[${idx}]`);
    }
  }

  if (params.replyTo) {
    const replyToAddresses = Array.isArray(params.replyTo) ? params.replyTo : [params.replyTo];
    for (const [idx, addr] of replyToAddresses.entries()) {
      validateEmailAddress(addr, `replyTo[${idx}]`);
    }
  }
}

// Every address error states the expected format, gives a copyable example, and
// echoes what was actually received — the standard set by the phone-number
// validation in @wraps.dev/sms.
const EXPECTED_FORMAT =
  'Expected an email address (e.g., user@example.com) or RFC 5322 form (e.g., "Ada Lovelace" <user@example.com>)';

/**
 * Render what the caller actually passed, for the tail of an address error.
 * Objects are shown in full so a missing `email` key is visible rather than
 * echoing back an empty string.
 */
function describeAddress(address: string | EmailAddress): string {
  if (typeof address === 'string') {
    // Quote blank input; an unquoted empty or whitespace-only value makes the
    // error trail off into nothing.
    return address.trim() === '' ? `"${address}" (blank)` : address;
  }
  return JSON.stringify(address);
}

/**
 * Extract email from RFC 5322 format strings like "Name <email>" or "email"
 */
function extractEmail(address: string): string {
  // Match email in angle brackets: "Name <email>" or just "<email>"
  const angleMatch = address.match(/<([^>]+)>/);
  if (angleMatch) {
    return angleMatch[1].trim();
  }

  // No angle brackets - treat as plain email address
  return address.trim();
}

/**
 * Basic email address validation using Zod
 * Zod's email validation is safer than custom regex patterns and avoids ReDoS vulnerabilities
 * Supports RFC 5322 format: "Display Name <email@example.com>" or plain "email@example.com"
 */
function validateEmailAddress(address: string | EmailAddress, field: string): void {
  // Reject CRLF in the full address string or in EmailAddress fields
  if (typeof address === 'string') {
    assertNoHeaderInjection(address, field);
  } else {
    assertNoHeaderInjection(address.email, field);
    if (address.name) {
      assertNoHeaderInjection(address.name, field);
    }
  }

  // Extract email portion from string or EmailAddress object
  const email = typeof address === 'string' ? extractEmail(address) : address.email;

  if (!email) {
    throw new ValidationError(
      `Missing email address in field: ${field}. ${EXPECTED_FORMAT}, got: ${describeAddress(address)}`,
      field
    );
  }

  // Zod Mini email validator — tree-shakeable; avoids bundling all of zod at the
  // edge. Behavior is identical to z.string().email() (verified). See plan 002.
  const result = safeParse(zEmail(), email);

  if (!result.success) {
    throw new ValidationError(
      `Invalid email format in field: ${field}. ${EXPECTED_FORMAT}, got: ${describeAddress(address)}`,
      field
    );
  }
}
