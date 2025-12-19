import { z } from 'zod';
import { ValidationError } from '../errors';
import type { BatchMessage, BatchOptions, SendOptions } from '../types';

/**
 * E.164 phone number format regex
 * Format: + followed by 1-15 digits
 * Examples: +14155551234, +442071234567
 */
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * Zod schema for E.164 phone number validation
 */
const phoneNumberSchema = z
  .string()
  .regex(E164_REGEX, 'Phone number must be in E.164 format (e.g., +14155551234)');

/**
 * Validate a phone number is in E.164 format
 * @param phoneNumber - The phone number to validate
 * @param field - Field name for error messages
 * @throws ValidationError if the phone number is invalid
 */
export function validatePhoneNumber(phoneNumber: string, field: string): void {
  const result = phoneNumberSchema.safeParse(phoneNumber);

  if (!result.success) {
    throw new ValidationError(
      `Invalid phone number format in field: ${field}. Expected E.164 format (e.g., +14155551234), got: ${phoneNumber}`,
      field
    );
  }
}

/**
 * Calculate the number of SMS segments for a message
 * GSM-7 encoding: 160 chars per segment, or 153 if multipart
 * UCS-2 encoding (Unicode): 70 chars per segment, or 67 if multipart
 *
 * @param message - The message text
 * @returns Number of segments the message will be split into
 */
export function calculateSegments(message: string): number {
  // Check if message contains non-GSM-7 characters (requires UCS-2)
  // GSM-7 basic charset includes ASCII printable chars plus some extended chars
  // Using a simpler check: if any char has code point > 127, treat as Unicode
  const isUnicode = [...message].some((char) => char.charCodeAt(0) > 127);

  const length = message.length;

  if (isUnicode) {
    // UCS-2 encoding
    if (length <= 70) {
      return 1;
    }
    return Math.ceil(length / 67);
  }
  // GSM-7 encoding
  if (length <= 160) {
    return 1;
  }
  return Math.ceil(length / 153);
}

/**
 * Validate send options
 * @param options - The send options to validate
 * @throws ValidationError if validation fails
 */
export function validateSendOptions(options: SendOptions): void {
  // Validate required fields
  if (!options.to) {
    throw new ValidationError('Missing required field: to', 'to');
  }

  if (!options.message) {
    throw new ValidationError('Missing required field: message', 'message');
  }

  // Validate phone number format
  validatePhoneNumber(options.to, 'to');

  // Validate from number if provided
  if (options.from) {
    // from can be a phone number ID, ARN, or E.164 number
    // If it looks like a phone number (starts with +), validate it
    if (options.from.startsWith('+')) {
      validatePhoneNumber(options.from, 'from');
    }
  }

  // Validate message length (AWS limit: 1600 characters for SMS)
  if (options.message.length > 1600) {
    throw new ValidationError(
      `Message exceeds maximum length of 1600 characters (got ${options.message.length})`,
      'message'
    );
  }

  // Validate maxPrice if provided
  if (options.maxPrice !== undefined) {
    const price = Number.parseFloat(options.maxPrice);
    if (Number.isNaN(price) || price <= 0) {
      throw new ValidationError(
        'maxPrice must be a positive number string (e.g., "0.05")',
        'maxPrice'
      );
    }
  }

  // Validate TTL if provided
  if (options.ttl !== undefined) {
    if (!Number.isInteger(options.ttl) || options.ttl <= 0) {
      throw new ValidationError('ttl must be a positive integer (seconds)', 'ttl');
    }
  }

  // Validate messageType if provided
  if (options.messageType && !['TRANSACTIONAL', 'PROMOTIONAL'].includes(options.messageType)) {
    throw new ValidationError(
      'messageType must be either "TRANSACTIONAL" or "PROMOTIONAL"',
      'messageType'
    );
  }
}

/**
 * Validate batch send options
 * @param options - The batch options to validate
 * @throws ValidationError if validation fails
 */
export function validateBatchOptions(options: BatchOptions): void {
  if (!options.messages || !Array.isArray(options.messages)) {
    throw new ValidationError('Missing required field: messages (must be an array)', 'messages');
  }

  if (options.messages.length === 0) {
    throw new ValidationError('messages array cannot be empty', 'messages');
  }

  // Validate each message
  options.messages.forEach((msg: BatchMessage, index: number) => {
    if (!msg.to) {
      throw new ValidationError(
        `Missing required field: messages[${index}].to`,
        `messages[${index}].to`
      );
    }

    if (!msg.message) {
      throw new ValidationError(
        `Missing required field: messages[${index}].message`,
        `messages[${index}].message`
      );
    }

    validatePhoneNumber(msg.to, `messages[${index}].to`);

    if (msg.message.length > 1600) {
      throw new ValidationError(
        `messages[${index}].message exceeds maximum length of 1600 characters`,
        `messages[${index}].message`
      );
    }
  });

  // Validate from if provided
  if (options.from?.startsWith('+')) {
    validatePhoneNumber(options.from, 'from');
  }
}

/**
 * Sanitize a phone number by removing common formatting characters
 * Keeps the + prefix and digits only
 *
 * @param phoneNumber - The phone number to sanitize
 * @returns Sanitized phone number in E.164-like format
 */
export function sanitizePhoneNumber(phoneNumber: string): string {
  // Remove spaces, dashes, parentheses, and dots
  return phoneNumber.replace(/[\s\-().]/g, '');
}
