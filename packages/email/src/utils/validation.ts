import { z } from 'zod';
import { ValidationError } from '../errors';
import type { EmailAddress, SendEmailParams } from '../types';

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
  // Extract email portion from string or EmailAddress object
  const email = typeof address === 'string' ? extractEmail(address) : address.email;

  if (!email) {
    throw new ValidationError(`Invalid email address in field: ${field}`, field);
  }

  // Use Zod's built-in email validation (safer than custom regex)
  const emailSchema = z.string().email();
  const result = emailSchema.safeParse(email);

  if (!result.success) {
    throw new ValidationError(`Invalid email format in field: ${field} (${email})`, field);
  }
}
