import { ValidationError } from '../errors';
import type { EmailAddress, SendEmailParams } from '../types';

/**
 * Normalize email address to string format
 */
export function normalizeEmailAddress(
  address: string | EmailAddress
): string {
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
    throw new ValidationError(
      'Must provide at least one of: html, text, or react',
      'html'
    );
  }

  if (params.html && params.react) {
    throw new ValidationError(
      'Cannot provide both "html" and "react" parameters',
      'html'
    );
  }

  // Validate email addresses (basic validation)
  validateEmailAddress(params.from, 'from');

  const toAddresses = Array.isArray(params.to) ? params.to : [params.to];
  toAddresses.forEach((addr, idx) =>
    validateEmailAddress(addr, `to[${idx}]`)
  );

  if (params.cc) {
    const ccAddresses = Array.isArray(params.cc) ? params.cc : [params.cc];
    ccAddresses.forEach((addr, idx) =>
      validateEmailAddress(addr, `cc[${idx}]`)
    );
  }

  if (params.bcc) {
    const bccAddresses = Array.isArray(params.bcc) ? params.bcc : [params.bcc];
    bccAddresses.forEach((addr, idx) =>
      validateEmailAddress(addr, `bcc[${idx}]`)
    );
  }

  if (params.replyTo) {
    const replyToAddresses = Array.isArray(params.replyTo)
      ? params.replyTo
      : [params.replyTo];
    replyToAddresses.forEach((addr, idx) =>
      validateEmailAddress(addr, `replyTo[${idx}]`)
    );
  }
}

/**
 * Basic email address validation
 */
function validateEmailAddress(
  address: string | EmailAddress,
  field: string
): void {
  const email = typeof address === 'string' ? address : address.email;

  if (!email) {
    throw new ValidationError(`Invalid email address in field: ${field}`, field);
  }

  // Basic email regex validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError(
      `Invalid email format in field: ${field} (${email})`,
      field
    );
  }
}
