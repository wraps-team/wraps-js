import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from './errors';
import { WrapsInbox } from './inbox';

// Mock S3 client
const mockS3Send = vi.fn();
const mockS3Client = { send: mockS3Send } as any;

// Mock SES client
const mockSesSend = vi.fn();
const mockSesClient = { send: mockSesSend } as any;

// Helper: build a parsed email fixture in S3
function makeParsedEmail(overrides: Record<string, unknown> = {}) {
  return {
    emailId: 'email-123',
    messageId: '<original@example.com>',
    from: { address: 'alice@example.com', name: 'Alice' },
    to: [{ address: 'bob@example.com', name: 'Bob' }],
    cc: [],
    subject: 'Hello',
    date: '2025-01-15T10:00:00Z',
    html: '<p>Hi Bob</p>',
    htmlTruncated: false,
    text: 'Hi Bob',
    headers: {
      references: '<ref1@example.com>',
    },
    attachments: [],
    spamVerdict: 'PASS',
    virusVerdict: 'PASS',
    rawS3Key: 'raw/abc123',
    receivedAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

// Helper: make S3 GetObjectCommand return a JSON body
function mockS3GetObject(data: unknown) {
  return {
    Body: {
      transformToString: () => Promise.resolve(JSON.stringify(data)),
    },
  };
}

describe('WrapsInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requireSES', () => {
    it('should throw ValidationError when no SES client is provided', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket');

      await expect(
        inbox.forward('email-123', {
          to: 'recipient@example.com',
          from: 'sender@example.com',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should not throw when SES client is provided', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail();

      // Mock: get parsed email, get raw MIME, send
      mockS3Send
        .mockResolvedValueOnce(mockS3GetObject(email)) // get() for parsed email
        .mockResolvedValueOnce({
          // GetObjectCommand for raw MIME
          Body: {
            transformToString: () =>
              Promise.resolve(
                'From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Hello\r\n\r\nHi Bob'
              ),
          },
        });

      mockSesSend.mockResolvedValueOnce({
        MessageId: 'fwd-msg-id',
        $metadata: { requestId: 'req-1' },
      });

      const result = await inbox.forward('email-123', {
        to: 'recipient@example.com',
        from: 'sender@example.com',
      });

      expect(result.messageId).toBe('fwd-msg-id');
    });
  });

  describe('forward() - passthrough mode', () => {
    it('should rewrite From and To headers in raw MIME', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail();
      const rawMime =
        'From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Hello\r\nMIME-Version: 1.0\r\n\r\nHi Bob';

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email)).mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(rawMime) },
      });

      mockSesSend.mockResolvedValueOnce({
        MessageId: 'fwd-123',
        $metadata: { requestId: 'req-fwd' },
      });

      await inbox.forward('email-123', {
        to: 'charlie@example.com',
        from: 'forwarding@myapp.com',
      });

      // Verify SES was called with rewritten raw message
      expect(mockSesSend).toHaveBeenCalledOnce();
      const sentCommand = mockSesSend.mock.calls[0][0];
      const sentRaw = new TextDecoder().decode(sentCommand.input.RawMessage.Data);

      expect(sentRaw).toContain('From: forwarding@myapp.com');
      expect(sentRaw).toContain('To: charlie@example.com');
      expect(sentRaw).not.toContain('From: alice@example.com');
      expect(sentCommand.input.Source).toBe('forwarding@myapp.com');
      expect(sentCommand.input.Destinations).toEqual(['charlie@example.com']);
    });

    it('should prefix subject when addPrefix is set', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail();
      const rawMime =
        'From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Hello\r\n\r\nbody';

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email)).mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(rawMime) },
      });

      mockSesSend.mockResolvedValueOnce({
        MessageId: 'fwd-prefix',
        $metadata: { requestId: 'req-pfx' },
      });

      await inbox.forward('email-123', {
        to: 'charlie@example.com',
        from: 'fwd@myapp.com',
        addPrefix: '[FWD]',
      });

      const sentRaw = new TextDecoder().decode(mockSesSend.mock.calls[0][0].input.RawMessage.Data);
      expect(sentRaw).toContain('Subject: [FWD] Hello');
    });

    it('should handle multiple recipients', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail();
      const rawMime =
        'From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Hello\r\n\r\nbody';

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email)).mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(rawMime) },
      });

      mockSesSend.mockResolvedValueOnce({
        MessageId: 'fwd-multi',
        $metadata: { requestId: 'req-multi' },
      });

      await inbox.forward('email-123', {
        to: ['charlie@example.com', 'dave@example.com'],
        from: 'fwd@myapp.com',
      });

      const sentCommand = mockSesSend.mock.calls[0][0];
      expect(sentCommand.input.Destinations).toEqual(['charlie@example.com', 'dave@example.com']);
    });
  });

  describe('forward() - wrapped mode', () => {
    it('should build new message with forwarded banner', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail({
        subject: 'Original Subject',
        text: 'Original body text',
        html: '<p>Original HTML</p>',
      });

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email));

      mockSesSend.mockResolvedValueOnce({
        MessageId: 'wrap-123',
        $metadata: { requestId: 'req-wrap' },
      });

      await inbox.forward('email-123', {
        to: 'charlie@example.com',
        from: 'fwd@myapp.com',
        passthrough: false,
        text: 'Check this out:',
      });

      const sentRaw = new TextDecoder().decode(mockSesSend.mock.calls[0][0].input.RawMessage.Data);

      // Subject should be prefixed
      expect(sentRaw).toContain('Subject: Fwd: Original Subject');
      // Should contain forwarded banner
      expect(sentRaw).toContain('---------- Forwarded message ----------');
      // Should contain prepended text
      expect(sentRaw).toContain('Check this out:');
      // Should contain original sender info
      expect(sentRaw).toContain('From: Alice <alice@example.com>');
    });

    it('should use custom prefix in wrapped mode', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail({ subject: 'Test' });

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email));
      mockSesSend.mockResolvedValueOnce({
        MessageId: 'wrap-pfx',
        $metadata: { requestId: 'req-pfx' },
      });

      await inbox.forward('email-123', {
        to: 'charlie@example.com',
        from: 'fwd@myapp.com',
        passthrough: false,
        addPrefix: 'FW:',
      });

      const sentRaw = new TextDecoder().decode(mockSesSend.mock.calls[0][0].input.RawMessage.Data);
      expect(sentRaw).toContain('Subject: FW: Test');
    });
  });

  describe('reply()', () => {
    it('should set In-Reply-To and References headers', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail({
        messageId: '<msg-abc@example.com>',
        headers: { references: '<ref-1@example.com> <ref-2@example.com>' },
      });

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email));
      mockSesSend.mockResolvedValueOnce({
        MessageId: 'reply-123',
        $metadata: { requestId: 'req-reply' },
      });

      const result = await inbox.reply('email-123', {
        from: 'support@myapp.com',
        text: 'Thanks for your email!',
      });

      expect(result.messageId).toBe('reply-123');

      const sentRaw = new TextDecoder().decode(mockSesSend.mock.calls[0][0].input.RawMessage.Data);

      expect(sentRaw).toContain('In-Reply-To: <msg-abc@example.com>');
      expect(sentRaw).toContain(
        'References: <ref-1@example.com> <ref-2@example.com> <msg-abc@example.com>'
      );
    });

    it('should reply to the original sender', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail({
        from: { address: 'customer@example.com', name: 'Customer' },
      });

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email));
      mockSesSend.mockResolvedValueOnce({
        MessageId: 'reply-to',
        $metadata: { requestId: 'req-to' },
      });

      await inbox.reply('email-123', {
        from: 'support@myapp.com',
        text: 'Reply body',
      });

      const sentRaw = new TextDecoder().decode(mockSesSend.mock.calls[0][0].input.RawMessage.Data);
      expect(sentRaw).toContain('To: Customer <customer@example.com>');
    });

    it('should prepend Re: to subject if not already present', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail({ subject: 'Question about billing' });

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email));
      mockSesSend.mockResolvedValueOnce({
        MessageId: 'reply-re',
        $metadata: { requestId: 'req-re' },
      });

      await inbox.reply('email-123', {
        from: 'support@myapp.com',
        text: 'Here is your answer',
      });

      const sentRaw = new TextDecoder().decode(mockSesSend.mock.calls[0][0].input.RawMessage.Data);
      expect(sentRaw).toContain('Subject: Re: Question about billing');
    });

    it('should not double-prefix Re: on subject', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail({ subject: 'Re: Already replied' });

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email));
      mockSesSend.mockResolvedValueOnce({
        MessageId: 'reply-nore',
        $metadata: { requestId: 'req-nore' },
      });

      await inbox.reply('email-123', {
        from: 'support@myapp.com',
        text: 'Follow up',
      });

      const sentRaw = new TextDecoder().decode(mockSesSend.mock.calls[0][0].input.RawMessage.Data);
      expect(sentRaw).toContain('Subject: Re: Already replied');
      expect(sentRaw).not.toContain('Subject: Re: Re:');
    });

    it('should handle References when no existing references', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail({
        messageId: '<first-msg@example.com>',
        headers: {}, // no existing references
      });

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email));
      mockSesSend.mockResolvedValueOnce({
        MessageId: 'reply-noref',
        $metadata: { requestId: 'req-noref' },
      });

      await inbox.reply('email-123', {
        from: 'support@myapp.com',
        text: 'Reply',
      });

      const sentRaw = new TextDecoder().decode(mockSesSend.mock.calls[0][0].input.RawMessage.Data);
      expect(sentRaw).toContain('In-Reply-To: <first-msg@example.com>');
      expect(sentRaw).toContain('References: <first-msg@example.com>');
    });

    it('should include attachments when provided', async () => {
      const inbox = new WrapsInbox(mockS3Client, 'test-bucket', mockSesClient);
      const email = makeParsedEmail();

      mockS3Send.mockResolvedValueOnce(mockS3GetObject(email));
      mockSesSend.mockResolvedValueOnce({
        MessageId: 'reply-att',
        $metadata: { requestId: 'req-att' },
      });

      await inbox.reply('email-123', {
        from: 'support@myapp.com',
        text: 'See attached',
        attachments: [
          {
            filename: 'report.pdf',
            content: Buffer.from('pdf-content'),
            contentType: 'application/pdf',
          },
        ],
      });

      const sentRaw = new TextDecoder().decode(mockSesSend.mock.calls[0][0].input.RawMessage.Data);
      expect(sentRaw).toContain('Content-Type: multipart/mixed');
      expect(sentRaw).toContain('filename="report.pdf"');
    });
  });
});
