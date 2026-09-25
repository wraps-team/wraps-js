import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import { validateCustomHeaders } from './headers';

describe('validateCustomHeaders', () => {
  it('accepts a valid List-Unsubscribe / List-Unsubscribe-Post pair, in order', () => {
    const result = validateCustomHeaders({
      'List-Unsubscribe': '<https://example.com/unsubscribe>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });

    expect(result).toEqual([
      { name: 'List-Unsubscribe', value: '<https://example.com/unsubscribe>' },
      { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
    ]);
  });

  it('rejects an empty header name', () => {
    expect(() => validateCustomHeaders({ '': 'value' })).toThrow(ValidationError);
  });

  it('rejects a header name longer than 126 characters', () => {
    const longName = 'X-'.padEnd(127, 'a');
    expect(() => validateCustomHeaders({ [longName]: 'value' })).toThrow(ValidationError);
  });

  it('rejects a header name with a character outside ASCII 33-126', () => {
    expect(() => validateCustomHeaders({ 'X-Café': 'value' })).toThrow(ValidationError);
  });

  it('rejects a header name containing a colon', () => {
    expect(() => validateCustomHeaders({ 'X-Bad:Name': 'value' })).toThrow(ValidationError);
  });

  it('rejects a header value longer than 995 characters', () => {
    const longValue = 'a'.repeat(996);
    expect(() => validateCustomHeaders({ 'X-Custom': longValue })).toThrow(ValidationError);
  });

  it('rejects a header value with CRLF (header injection)', () => {
    expect(() => validateCustomHeaders({ 'X-Custom': 'line1\r\nline2' })).toThrow(ValidationError);
  });

  it('rejects a header value with a bare LF', () => {
    expect(() => validateCustomHeaders({ 'X-Custom': 'line1\nline2' })).toThrow(ValidationError);
  });

  it('rejects a header value with a tab', () => {
    expect(() => validateCustomHeaders({ 'X-Custom': 'a\tb' })).toThrow(ValidationError);
  });

  it('rejects when name + value exceed 996 characters combined, even though each alone is within its own limit', () => {
    const name = 'X-Custom'; // 8 chars
    const value = 'a'.repeat(990); // within the 995-char value limit alone
    expect(name.length).toBeLessThanOrEqual(126);
    expect(value.length).toBeLessThanOrEqual(995);
    expect(name.length + value.length).toBeGreaterThan(996);
    expect(() => validateCustomHeaders({ [name]: value })).toThrow(ValidationError);
  });

  it('rejects more than 50 headers', () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i < 51; i++) {
      headers[`X-Header-${i}`] = 'value';
    }
    expect(() => validateCustomHeaders(headers)).toThrow(ValidationError);
  });

  it.each(['From', 'To', 'Cc', 'Bcc', 'Reply-To', 'Subject', 'Date', 'Message-Id'])(
    'rejects the reserved header %s',
    (name) => {
      expect(() => validateCustomHeaders({ [name]: 'value' })).toThrow(ValidationError);
    }
  );

  it('rejects a reserved header name in mixed case (Reply-To)', () => {
    expect(() => validateCustomHeaders({ 'Reply-To': 'someone@example.com' })).toThrow(
      ValidationError
    );
  });

  it('rejects a reserved header name in upper case (SUBJECT)', () => {
    expect(() => validateCustomHeaders({ SUBJECT: 'Hello' })).toThrow(ValidationError);
  });

  it('sets field: "headers" on the thrown error', () => {
    try {
      validateCustomHeaders({ Subject: 'Hello' });
      throw new Error('expected validateCustomHeaders to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).field).toBe('headers');
    }
  });
});
