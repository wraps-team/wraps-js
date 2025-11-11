import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import type { EmailAddress, SendEmailParams } from '../types';
import { normalizeEmailAddress, normalizeEmailAddresses, validateEmailParams } from './validation';

describe('normalizeEmailAddress', () => {
  it('should return string email as-is', () => {
    expect(normalizeEmailAddress('test@example.com')).toBe('test@example.com');
  });

  it('should format EmailAddress with name', () => {
    const address: EmailAddress = {
      email: 'test@example.com',
      name: 'Test User',
    };
    expect(normalizeEmailAddress(address)).toBe('"Test User" <test@example.com>');
  });

  it('should return email without name when name is not provided', () => {
    const address: EmailAddress = {
      email: 'test@example.com',
    };
    expect(normalizeEmailAddress(address)).toBe('test@example.com');
  });
});

describe('normalizeEmailAddresses', () => {
  it('should normalize a single string email', () => {
    const result = normalizeEmailAddresses('test@example.com');
    expect(result).toEqual(['test@example.com']);
  });

  it('should normalize an array of string emails', () => {
    const result = normalizeEmailAddresses(['test1@example.com', 'test2@example.com']);
    expect(result).toEqual(['test1@example.com', 'test2@example.com']);
  });

  it('should normalize EmailAddress objects', () => {
    const addresses: EmailAddress[] = [
      { email: 'test1@example.com', name: 'User 1' },
      { email: 'test2@example.com' },
    ];
    const result = normalizeEmailAddresses(addresses);
    expect(result).toEqual(['"User 1" <test1@example.com>', 'test2@example.com']);
  });

  it('should normalize mixed string and EmailAddress', () => {
    const result = normalizeEmailAddresses({
      email: 'test@example.com',
      name: 'Test',
    });
    expect(result).toEqual(['"Test" <test@example.com>']);
  });
});

describe('validateEmailParams', () => {
  it('should pass validation for valid params', () => {
    const params: SendEmailParams = {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    };

    expect(() => validateEmailParams(params)).not.toThrow();
  });

  it('should throw ValidationError when from is missing', () => {
    const params = {
      to: 'recipient@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    } as SendEmailParams;

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
    expect(() => validateEmailParams(params)).toThrow('Missing required field: from');
  });

  it('should throw ValidationError when to is missing', () => {
    const params = {
      from: 'sender@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    } as SendEmailParams;

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
    expect(() => validateEmailParams(params)).toThrow('Missing required field: to');
  });

  it('should throw ValidationError when subject is missing', () => {
    const params = {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      html: '<p>Test</p>',
    } as SendEmailParams;

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
    expect(() => validateEmailParams(params)).toThrow('Missing required field: subject');
  });

  it('should throw ValidationError when no content is provided', () => {
    const params = {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test',
    } as SendEmailParams;

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
    expect(() => validateEmailParams(params)).toThrow(
      'Must provide at least one of: html, text, or react'
    );
  });

  it('should allow text-only emails', () => {
    const params: SendEmailParams = {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test',
      text: 'Plain text',
    };

    expect(() => validateEmailParams(params)).not.toThrow();
  });

  it('should throw ValidationError for invalid email format', () => {
    const params: SendEmailParams = {
      from: 'invalid-email',
      to: 'recipient@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    };

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
    expect(() => validateEmailParams(params)).toThrow('Invalid email format');
  });

  it('should validate array of email addresses', () => {
    const params: SendEmailParams = {
      from: 'sender@example.com',
      to: ['valid@example.com', 'invalid-email'],
      subject: 'Test',
      html: '<p>Test</p>',
    };

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
  });

  it('should validate EmailAddress objects', () => {
    const params: SendEmailParams = {
      from: { email: 'sender@example.com', name: 'Sender' },
      to: { email: 'recipient@example.com', name: 'Recipient' },
      subject: 'Test',
      html: '<p>Test</p>',
    };

    expect(() => validateEmailParams(params)).not.toThrow();
  });

  it('should validate cc, bcc, and replyTo addresses', () => {
    const params: SendEmailParams = {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      cc: 'invalid-cc',
      subject: 'Test',
      html: '<p>Test</p>',
    };

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
  });

  it('should throw error when both html and react are provided', () => {
    const params: SendEmailParams = {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
      react: {} as any, // Mock React element
    };

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
    expect(() => validateEmailParams(params)).toThrow(
      'Cannot provide both "html" and "react" parameters'
    );
  });

  it('should validate bcc addresses', () => {
    const params: SendEmailParams = {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      bcc: ['valid@example.com', 'invalid-bcc'],
      subject: 'Test',
      html: '<p>Test</p>',
    };

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
  });

  it('should validate replyTo addresses', () => {
    const params: SendEmailParams = {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      replyTo: 'invalid-reply',
      subject: 'Test',
      html: '<p>Test</p>',
    };

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
  });

  it('should validate empty email in EmailAddress object', () => {
    const params: SendEmailParams = {
      from: { email: '', name: 'Sender' },
      to: 'recipient@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    };

    expect(() => validateEmailParams(params)).toThrow(ValidationError);
    expect(() => validateEmailParams(params)).toThrow('Invalid email address');
  });
});
