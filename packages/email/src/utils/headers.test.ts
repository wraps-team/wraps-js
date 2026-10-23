import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import { encodeHeaderText, hasNonAscii, validateCustomHeaders } from './headers';

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

// Decode what encodeHeaderText produced: unfold, then base64 each encoded-word.
function decodeWords(encoded: string): string {
  return encoded
    .split('\r\n ')
    .map((word) => {
      const match = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(word);
      if (!match?.[1]) throw new Error(`not an encoded-word: ${word}`);
      return Buffer.from(match[1], 'base64').toString('utf8');
    })
    .join('');
}

describe('hasNonAscii', () => {
  it('is false for ASCII, including controls and DEL', () => {
    expect(hasNonAscii('Re: [#12] Card declined\t~\u007f')).toBe(false);
  });

  it('is true for any character above 0x7f', () => {
    expect(hasNonAscii('café')).toBe(true);
    expect(hasNonAscii('a\u0080')).toBe(true);
    expect(hasNonAscii('🙂')).toBe(true);
  });
});

describe('encodeHeaderText', () => {
  it('returns ASCII text unchanged', () => {
    expect(encodeHeaderText('Re: [#12] Welcome, "friend" <3')).toBe(
      'Re: [#12] Welcome, "friend" <3'
    );
    expect(encodeHeaderText('')).toBe('');
  });

  it('encodes non-ASCII text as one RFC 2047 encoded-word', () => {
    const encoded = encodeHeaderText('Ünïcode — café');
    expect(encoded).toBe(`=?UTF-8?B?${Buffer.from('Ünïcode — café').toString('base64')}?=`);
    expect(decodeWords(encoded)).toBe('Ünïcode — café');
  });

  it('keeps the ASCII parts of a mixed string inside the word', () => {
    expect(decodeWords(encodeHeaderText('Re: Ünï [#12]'))).toBe('Re: Ünï [#12]');
  });

  it('produces ASCII only', () => {
    expect(hasNonAscii(encodeHeaderText('日本語のテスト 🙂'))).toBe(false);
  });

  it('splits long text into words of at most 75 characters, folded with CRLF + space', () => {
    const text = 'é'.repeat(200);
    const encoded = encodeHeaderText(text);
    const words = encoded.split('\r\n ');
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) {
      expect(word.length).toBeLessThanOrEqual(75);
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    expect(decodeWords(encoded)).toBe(text);
    // the only line breaks are the folding ones
    expect(encoded.replace(/\r\n /g, '')).not.toMatch(/[\r\n]/);
  });

  it('never cuts a character across two words', () => {
    // 4-byte characters: 45 bytes would split one in the middle
    const text = '🙂'.repeat(50);
    const encoded = encodeHeaderText(text);
    for (const word of encoded.split('\r\n ')) {
      const decoded = decodeWords(word);
      expect(decoded).not.toContain('\uFFFD');
    }
    expect(decodeWords(encoded)).toBe(text);
  });
});
