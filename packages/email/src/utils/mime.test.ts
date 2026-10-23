import { describe, expect, it } from 'vitest';
import { buildRawEmailMessage } from './mime';

describe('MIME Message Builder', () => {
  describe('buildRawEmailMessage', () => {
    it('should build a basic email with text attachment', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test with Attachment',
        text: 'Please see the attached file.',
        attachments: [
          {
            filename: 'test.txt',
            content: Buffer.from('Hello, World!'),
            contentType: 'text/plain',
          },
        ],
      });

      // Verify basic structure
      expect(message).toContain('From: sender@example.com');
      expect(message).toContain('To: recipient@example.com');
      expect(message).toContain('Subject: Test with Attachment');
      expect(message).toContain('MIME-Version: 1.0');
      expect(message).toContain('Content-Type: multipart/mixed');

      // Verify attachment
      expect(message).toContain('Content-Type: text/plain; name="test.txt"');
      expect(message).toContain('Content-Disposition: attachment; filename="test.txt"');
      expect(message).toContain('Content-Transfer-Encoding: base64');

      // Verify base64 encoding
      const base64Content = Buffer.from('Hello, World!').toString('base64');
      expect(message).toContain(base64Content);
    });

    it('should build email with HTML and text content', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Multipart Email',
        html: '<h1>Hello</h1><p>World</p>',
        text: 'Hello\nWorld',
        attachments: [
          {
            filename: 'document.pdf',
            content: Buffer.from('PDF content here'),
            contentType: 'application/pdf',
          },
        ],
      });

      // Verify multipart/alternative for text and HTML
      expect(message).toContain('Content-Type: multipart/alternative');
      expect(message).toContain('Content-Type: text/plain; charset=UTF-8');
      expect(message).toContain('Content-Type: text/html; charset=UTF-8');

      // Verify both versions present
      expect(message).toContain('Hello\nWorld');
      expect(message).toContain('<h1>Hello</h1><p>World</p>');

      // Verify attachment
      expect(message).toContain('Content-Type: application/pdf; name="document.pdf"');
    });

    it('should handle multiple attachments', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Multiple Attachments',
        text: 'Files attached',
        attachments: [
          {
            filename: 'file1.txt',
            content: Buffer.from('First file'),
          },
          {
            filename: 'file2.pdf',
            content: Buffer.from('Second file'),
            contentType: 'application/pdf',
          },
          {
            filename: 'file3.png',
            content: Buffer.from('Third file'),
            contentType: 'image/png',
          },
        ],
      });

      // Verify all attachments present
      expect(message).toContain('filename="file1.txt"');
      expect(message).toContain('filename="file2.pdf"');
      expect(message).toContain('filename="file3.png"');

      // Verify MIME types
      expect(message).toContain('Content-Type: text/plain; name="file1.txt"');
      expect(message).toContain('Content-Type: application/pdf; name="file2.pdf"');
      expect(message).toContain('Content-Type: image/png; name="file3.png"');
    });

    it('should handle email addresses with names', () => {
      const message = buildRawEmailMessage({
        from: { email: 'sender@example.com', name: 'John Doe' },
        to: [{ email: 'recipient1@example.com', name: 'Jane Smith' }, 'recipient2@example.com'],
        subject: 'Test',
        text: 'Test',
        attachments: [
          {
            filename: 'test.txt',
            content: Buffer.from('test'),
          },
        ],
      });

      expect(message).toContain('From: "John Doe" <sender@example.com>');
      expect(message).toContain(
        'To: "Jane Smith" <recipient1@example.com>, recipient2@example.com'
      );
    });

    it('should handle CC and BCC recipients', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        cc: ['cc1@example.com', 'cc2@example.com'],
        bcc: 'bcc@example.com',
        subject: 'Test',
        text: 'Test',
        attachments: [
          {
            filename: 'test.txt',
            content: Buffer.from('test'),
          },
        ],
      });

      expect(message).toContain('Cc: cc1@example.com, cc2@example.com');
      expect(message).toContain('Bcc: bcc@example.com');
    });

    it('should handle Reply-To header', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        replyTo: 'replyto@example.com',
        subject: 'Test',
        text: 'Test',
        attachments: [
          {
            filename: 'test.txt',
            content: Buffer.from('test'),
          },
        ],
      });

      expect(message).toContain('Reply-To: replyto@example.com');
    });

    it('should auto-detect MIME types from file extensions', () => {
      const testCases = [
        { filename: 'doc.pdf', expected: 'application/pdf' },
        {
          filename: 'sheet.xlsx',
          expected: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        { filename: 'image.png', expected: 'image/png' },
        { filename: 'photo.jpg', expected: 'image/jpeg' },
        { filename: 'data.json', expected: 'application/json' },
        { filename: 'archive.zip', expected: 'application/zip' },
        { filename: 'unknown.xyz', expected: 'application/octet-stream' },
      ];

      for (const { filename, expected } of testCases) {
        const message = buildRawEmailMessage({
          from: 'sender@example.com',
          to: 'recipient@example.com',
          subject: 'Test',
          text: 'Test',
          attachments: [
            {
              filename,
              content: Buffer.from('test'),
            },
          ],
        });

        expect(message).toContain(`Content-Type: ${expected}; name="${filename}"`);
      }
    });

    it('should properly encode base64 content with line breaks', () => {
      // Create content that will exceed 76 characters when base64 encoded
      const longContent = Buffer.from('A'.repeat(100));
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Test',
        attachments: [
          {
            filename: 'long.txt',
            content: longContent,
          },
        ],
      });

      // Base64 encoded content should be split into 76-character lines
      const lines = message.split('\r\n');
      const base64Lines = lines.filter((line) => /^[A-Za-z0-9+/=]+$/.test(line));

      // Check that base64 lines don't exceed 76 characters (RFC 2045 requirement)
      for (const line of base64Lines) {
        expect(line.length).toBeLessThanOrEqual(76);
      }
    });

    it('should handle base64 string input for attachment content', () => {
      const base64Content = Buffer.from('Hello, World!').toString('base64');
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Test',
        attachments: [
          {
            filename: 'test.txt',
            content: base64Content,
          },
        ],
      });

      // The base64 content should be decoded and re-encoded properly
      expect(message).toContain('Content-Transfer-Encoding: base64');
      expect(message).toContain(base64Content);
    });

    it('should use CRLF line endings', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Test',
        attachments: [
          {
            filename: 'test.txt',
            content: Buffer.from('test'),
          },
        ],
      });

      // MIME requires CRLF (\r\n) line endings
      expect(message).toContain('\r\n');
      expect(message.split('\r\n').length).toBeGreaterThan(5);
    });

    it('should properly escape special characters in email names', () => {
      const message = buildRawEmailMessage({
        from: { email: 'sender@example.com', name: 'John "The Boss" Doe' },
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Test',
        attachments: [
          {
            filename: 'test.txt',
            content: Buffer.from('test'),
          },
        ],
      });

      // Quotes should be escaped
      expect(message).toContain('From: "John \\"The Boss\\" Doe" <sender@example.com>');
    });

    it('should include custom headers before MIME-Version', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Re: Original thread',
        text: 'Reply body',
        customHeaders: {
          'In-Reply-To': '<original-msg-id@example.com>',
          References: '<ref1@example.com> <original-msg-id@example.com>',
        },
      });

      expect(message).toContain('In-Reply-To: <original-msg-id@example.com>');
      expect(message).toContain('References: <ref1@example.com> <original-msg-id@example.com>');

      // Custom headers should appear before MIME-Version
      const inReplyToIdx = message.indexOf('In-Reply-To:');
      const mimeVersionIdx = message.indexOf('MIME-Version:');
      expect(inReplyToIdx).toBeLessThan(mimeVersionIdx);
    });

    it('should build text-only email without attachments', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Plain text',
        text: 'Hello world',
      });

      expect(message).toContain('From: sender@example.com');
      expect(message).toContain('Subject: Plain text');
      expect(message).toContain('Content-Type: text/plain; charset=UTF-8');
      expect(message).toContain('Hello world');
      // Should NOT have multipart/mixed wrapper
      expect(message).not.toContain('multipart/mixed');
    });

    it('should build HTML-only email without attachments', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'HTML only',
        html: '<h1>Hello</h1>',
      });

      expect(message).toContain('Content-Type: text/html; charset=UTF-8');
      expect(message).toContain('<h1>Hello</h1>');
      expect(message).not.toContain('multipart/mixed');
    });

    it('should build multipart/alternative for text+html without attachments', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Both',
        text: 'Plain version',
        html: '<p>HTML version</p>',
      });

      expect(message).toContain('Content-Type: multipart/alternative');
      expect(message).toContain('Content-Type: text/plain; charset=UTF-8');
      expect(message).toContain('Content-Type: text/html; charset=UTF-8');
      expect(message).toContain('Plain version');
      expect(message).toContain('<p>HTML version</p>');
      // Should NOT have multipart/mixed (no attachments)
      expect(message).not.toContain('multipart/mixed');
    });

    it('should combine custom headers with no-attachment path', () => {
      const message = buildRawEmailMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Re: Thread',
        text: 'Reply',
        customHeaders: {
          'In-Reply-To': '<msg@example.com>',
        },
      });

      expect(message).toContain('In-Reply-To: <msg@example.com>');
      expect(message).toContain('Content-Type: text/plain; charset=UTF-8');
      expect(message).not.toContain('multipart/mixed');
    });
  });

  describe('non-ASCII headers', () => {
    const base = { to: 'recipient@example.com', html: '<p>hi</p>' };
    // top-level header lines, unfolded
    const headerBlock = (message: string) =>
      message.slice(0, message.indexOf('\r\n\r\n')).replace(/\r\n[ \t]+/g, ' ');

    it('encodes a non-ASCII subject as RFC 2047 encoded-words', () => {
      const message = buildRawEmailMessage({
        ...base,
        from: 'sender@example.com',
        subject: 'Re: Ünïcode — café',
        customHeaders: { 'In-Reply-To': '<a1@example.com>' },
      });

      const encoded = Buffer.from('Re: Ünïcode — café').toString('base64');
      expect(message).toContain(`\r\nSubject: =?UTF-8?B?${encoded}?=\r\n`);
      // every byte of the top-level headers is ASCII
      expect(Buffer.from(headerBlock(message), 'utf8').every((b) => b < 0x80)).toBe(true);
    });

    it('leaves an ASCII subject alone', () => {
      const message = buildRawEmailMessage({
        ...base,
        from: 'sender@example.com',
        subject: '[#12] Re: Card declined',
      });
      expect(message).toContain('\r\nSubject: [#12] Re: Card declined\r\n');
    });

    it('folds a long non-ASCII subject so each encoded-word fits in 75 characters', () => {
      const subject = 'Ünï '.repeat(60);
      const message = buildRawEmailMessage({ ...base, from: 'sender@example.com', subject });

      const lines = message
        .slice(message.indexOf('Subject: '), message.indexOf('\r\nMIME-Version'))
        .split('\r\n');
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines.slice(1)) {
        expect(line).toMatch(/^ =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      }
      const decoded = lines
        .map((line) => line.replace(/^Subject: /, '').trim())
        .map((word) => Buffer.from(word.slice('=?UTF-8?B?'.length, -2), 'base64').toString('utf8'))
        .join('');
      expect(decoded).toBe(subject);
    });

    it('encodes a non-ASCII display name, and quotes an ASCII one as before', () => {
      const message = buildRawEmailMessage({
        ...base,
        from: { name: 'Zoë Müller', email: 'zoe@example.com' },
        to: [
          { name: 'Ana, "A" Díaz', email: 'ana@example.com' },
          { name: 'Plain, Name', email: 'plain@example.com' },
        ],
        subject: 'Hi',
      });

      const zoe = Buffer.from('Zoë Müller').toString('base64');
      const ana = Buffer.from('Ana, "A" Díaz').toString('base64');
      expect(message.startsWith(`From: =?UTF-8?B?${zoe}?= <zoe@example.com>\r\n`)).toBe(true);
      expect(message).toContain(
        `\r\nTo: =?UTF-8?B?${ana}?= <ana@example.com>, "Plain, Name" <plain@example.com>\r\n`
      );
    });

    it('still rejects a line break in a non-ASCII subject or display name', () => {
      expect(() =>
        buildRawEmailMessage({
          ...base,
          from: 'sender@example.com',
          subject: 'Hé\r\nBcc: victim@example.com',
        })
      ).toThrow('Illegal newline in header field: subject');
      expect(() =>
        buildRawEmailMessage({
          ...base,
          from: { name: 'Zoë\r\nBcc: victim@example.com', email: 'zoe@example.com' },
          subject: 'Hi',
        })
      ).toThrow('Illegal newline in header field: address');
    });
  });

  describe('header injection', () => {
    it('should throw when subject contains CRLF', () => {
      expect(() =>
        buildRawEmailMessage({
          from: 'sender@example.com',
          to: 'recipient@example.com',
          subject: 'Hi\r\nBcc: victim@example.com',
          text: 'body',
        })
      ).toThrow('Illegal newline in header field: subject');
    });

    it('should throw when from display name contains CRLF', () => {
      expect(() =>
        buildRawEmailMessage({
          from: '"Evil\r\nBcc: victim@example.com" <real@example.com>',
          to: 'recipient@example.com',
          subject: 'Test',
          text: 'body',
        })
      ).toThrow('Illegal newline in header field: address');
    });

    it('should throw when customHeaders value contains CRLF', () => {
      expect(() =>
        buildRawEmailMessage({
          from: 'sender@example.com',
          to: 'recipient@example.com',
          subject: 'Test',
          text: 'body',
          customHeaders: {
            'X-Custom': 'safe\r\nBcc: victim@example.com',
          },
        })
      ).toThrow('Illegal newline in header field: customHeaders.value');
    });

    it('should throw when attachment filename contains CRLF', () => {
      expect(() =>
        buildRawEmailMessage({
          from: 'sender@example.com',
          to: 'recipient@example.com',
          subject: 'Test',
          text: 'body',
          attachments: [
            {
              filename: 'evil\r\nBcc: victim@example.com',
              content: Buffer.from('data'),
            },
          ],
        })
      ).toThrow('Illegal newline in header field: attachment.filename');
    });
  });
});
