import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WrapsEmail } from './client';
import { SESError, ValidationError } from './errors';

// Mock the SES client
vi.mock('@aws-sdk/client-ses', () => {
  const mockSend = vi.fn();
  const mockDestroy = vi.fn();

  return {
    SESClient: vi.fn(function (this: any) {
      this.send = mockSend;
      this.destroy = mockDestroy;
    }),
    SendEmailCommand: vi.fn(function (this: any, input: any) {
      Object.assign(this, input);
    }),
    SendRawEmailCommand: vi.fn(function (this: any, input: any) {
      Object.assign(this, input);
    }),
    SendTemplatedEmailCommand: vi.fn(function (this: any, input: any) {
      Object.assign(this, input);
    }),
    SendBulkTemplatedEmailCommand: vi.fn(function (this: any, input: any) {
      Object.assign(this, input);
    }),
    CreateTemplateCommand: vi.fn(function (this: any, input: any) {
      Object.assign(this, input);
    }),
    UpdateTemplateCommand: vi.fn(function (this: any, input: any) {
      Object.assign(this, input);
    }),
    GetTemplateCommand: vi.fn(function (this: any, input: any) {
      Object.assign(this, input);
    }),
    ListTemplatesCommand: vi.fn(function (this: any, input: any) {
      Object.assign(this, input);
    }),
    DeleteTemplateCommand: vi.fn(function (this: any, input: any) {
      Object.assign(this, input);
    }),
  };
});

// Mock validation
vi.mock('./utils/validation', () => ({
  validateEmailParams: vi.fn(),
  normalizeEmailAddress: vi.fn((addr) => (typeof addr === 'string' ? addr : addr.email)),
  normalizeEmailAddresses: vi.fn((addrs) => (Array.isArray(addrs) ? addrs : [addrs])),
}));

// Shared SSM mock for reply-threading tests. We pass a pre-configured
// ssmClient into `WrapsEmail` to avoid the `require('@aws-sdk/client-ssm')`
// path (which vi.mock cannot intercept when tsx compiles down to CJS).
const mockSsmSend = vi.fn();
const mockSsmClient = { send: mockSsmSend } as any;

// Mock react email
vi.mock('./react', () => ({
  renderReactEmail: vi.fn().mockResolvedValue({
    html: '<p>Rendered</p>',
    text: 'Rendered',
  }),
}));

describe('WrapsEmail', () => {
  let email: WrapsEmail;
  let mockSend: any;

  beforeEach(() => {
    vi.clearAllMocks();
    email = new WrapsEmail({ region: 'us-east-1' });
    // Get the mocked send function from the SESClient instance
    mockSend = (email as any).sesClient.send;
  });

  describe('constructor', () => {
    it('should create an instance', () => {
      expect(email).toBeInstanceOf(WrapsEmail);
    });

    it('should have templates namespace', () => {
      expect(email.templates).toBeDefined();
      expect(email.templates.create).toBeInstanceOf(Function);
      expect(email.templates.createFromReact).toBeInstanceOf(Function);
      expect(email.templates.update).toBeInstanceOf(Function);
      expect(email.templates.get).toBeInstanceOf(Function);
      expect(email.templates.list).toBeInstanceOf(Function);
      expect(email.templates.delete).toBeInstanceOf(Function);
    });
  });

  describe('send', () => {
    it('should send a simple email', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'test-message-id',
        $metadata: { requestId: 'test-request-id' },
      });

      const result = await email.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(result).toEqual({
        messageId: 'test-message-id',
        requestId: 'test-request-id',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should send email with React component', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'test-message-id',
        $metadata: { requestId: 'test-request-id' },
      });

      const result = await email.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        react: {} as any, // Mock React element
      });

      expect(result.messageId).toBe('test-message-id');
    });

    it('should send email with attachments using SendRawEmail', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'attachment-message-id',
        $metadata: { requestId: 'attachment-request-id' },
      });

      const result = await email.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test with Attachment',
        html: '<p>Test</p>',
        attachments: [
          {
            filename: 'test.pdf',
            content: Buffer.from('PDF content'),
            contentType: 'application/pdf',
          },
        ],
      });

      expect(result).toEqual({
        messageId: 'attachment-message-id',
        requestId: 'attachment-request-id',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      // Verify SendRawEmailCommand was used
      const command = mockSend.mock.calls[0][0];
      expect(command).toHaveProperty('RawMessage');
    });

    it('should send email with multiple attachments', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'multi-attach-id',
        $metadata: { requestId: 'multi-attach-request-id' },
      });

      const result = await email.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Multiple Attachments',
        text: 'See attached files',
        attachments: [
          {
            filename: 'doc1.pdf',
            content: Buffer.from('First doc'),
          },
          {
            filename: 'image.png',
            content: Buffer.from('Image data'),
            contentType: 'image/png',
          },
          {
            filename: 'data.json',
            content: Buffer.from('{"key": "value"}'),
            contentType: 'application/json',
          },
        ],
      });

      expect(result.messageId).toBe('multi-attach-id');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should send email with attachments and React component', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'react-attach-id',
        $metadata: { requestId: 'react-attach-request-id' },
      });

      const result = await email.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'React with Attachment',
        react: {} as any,
        attachments: [
          {
            filename: 'receipt.pdf',
            content: Buffer.from('Receipt data'),
          },
        ],
      });

      expect(result.messageId).toBe('react-attach-id');
    });

    it('should throw error for too many attachments', async () => {
      const attachments = Array.from({ length: 101 }, (_, i) => ({
        filename: `file${i}.txt`,
        content: Buffer.from('test'),
      }));

      await expect(
        email.send({
          from: 'sender@example.com',
          to: 'recipient@example.com',
          subject: 'Too many attachments',
          html: '<p>Test</p>',
          attachments,
        })
      ).rejects.toThrow('Maximum 100 attachments allowed');
    });

    it('should include tags and configuration set with attachments', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'tagged-attach-id',
        $metadata: { requestId: 'tagged-attach-request-id' },
      });

      const result = await email.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Tagged with Attachment',
        html: '<p>Test</p>',
        attachments: [
          {
            filename: 'doc.pdf',
            content: Buffer.from('test'),
          },
        ],
        tags: {
          campaign: 'newsletter',
          type: 'transactional',
        },
        configurationSetName: 'my-config-set',
      });

      expect(result.messageId).toBe('tagged-attach-id');

      const command = mockSend.mock.calls[0][0];
      expect(command).toHaveProperty('Tags');
      expect(command).toHaveProperty('ConfigurationSetName', 'my-config-set');
    });

    it('should handle SES errors', async () => {
      mockSend.mockRejectedValue({
        message: 'Rate limit exceeded',
        name: 'Throttling',
        $metadata: { requestId: 'error-request-id' },
        $retryable: { throttling: true },
      });

      await expect(
        email.send({
          from: 'sender@example.com',
          to: 'recipient@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        })
      ).rejects.toThrow(SESError);
    });
  });

  describe('sendTemplate', () => {
    it('should send email using template', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'template-message-id',
        $metadata: { requestId: 'template-request-id' },
      });

      const result = await email.sendTemplate({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        template: 'welcome-email',
        templateData: { name: 'John' },
      });

      expect(result).toEqual({
        messageId: 'template-message-id',
        requestId: 'template-request-id',
      });
    });

    it('should send template with optional parameters', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'template-message-id',
        $metadata: { requestId: 'template-request-id' },
      });

      const result = await email.sendTemplate({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        template: 'welcome-email',
        templateData: { name: 'John' },
        replyTo: 'reply@example.com',
        tags: { campaign: 'welcome' },
        configurationSetName: 'my-config-set',
      });

      expect(result.messageId).toBe('template-message-id');
    });
  });

  describe('sendBulkTemplate', () => {
    it('should send bulk emails', async () => {
      mockSend.mockResolvedValue({
        Status: [
          { MessageId: 'msg-1', Status: 'success' },
          { MessageId: 'msg-2', Status: 'success' },
        ],
        $metadata: { requestId: 'bulk-request-id' },
      });

      const result = await email.sendBulkTemplate({
        from: 'sender@example.com',
        template: 'newsletter',
        destinations: [
          { to: 'user1@example.com', templateData: { name: 'User 1' } },
          { to: 'user2@example.com', templateData: { name: 'User 2' } },
        ],
      });

      expect(result.status).toHaveLength(2);
      expect(result.status[0].status).toBe('success');
    });

    it('should throw error for more than 50 destinations', async () => {
      const destinations = Array.from({ length: 51 }, (_, i) => ({
        to: `user${i}@example.com`,
        templateData: {},
      }));

      await expect(
        email.sendBulkTemplate({
          from: 'sender@example.com',
          template: 'test',
          destinations,
        })
      ).rejects.toThrow('Maximum 50 destinations allowed');
    });

    it('should send bulk template with optional parameters', async () => {
      mockSend.mockResolvedValue({
        Status: [{ MessageId: 'msg-1', Status: 'success' }],
        $metadata: { requestId: 'bulk-request-id' },
      });

      const result = await email.sendBulkTemplate({
        from: 'sender@example.com',
        template: 'newsletter',
        destinations: [
          {
            to: 'user1@example.com',
            templateData: { name: 'User 1' },
            replacementTags: { type: 'vip' },
          },
        ],
        defaultTemplateData: { company: 'Acme Corp' },
        tags: { campaign: 'newsletter' },
        configurationSetName: 'newsletter-config',
      });

      expect(result.status).toHaveLength(1);
    });
  });

  describe('templates.create', () => {
    it('should create a template', async () => {
      mockSend.mockResolvedValue({});

      await email.templates.create({
        name: 'test-template',
        subject: 'Test Subject',
        html: '<p>Test</p>',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('templates.createFromReact', () => {
    it('should create template from React component', async () => {
      mockSend.mockResolvedValue({});

      await email.templates.createFromReact({
        name: 'react-template',
        subject: 'Test',
        react: {} as any,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('templates.update', () => {
    it('should update a template', async () => {
      mockSend.mockResolvedValue({});

      await email.templates.update({
        name: 'test-template',
        subject: 'Updated Subject',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('templates.get', () => {
    it('should get template details', async () => {
      mockSend.mockResolvedValue({
        Template: {
          TemplateName: 'test-template',
          SubjectPart: 'Test Subject',
          HtmlPart: '<p>Test</p>',
          TextPart: 'Test',
        },
      });

      const template = await email.templates.get('test-template');

      expect(template.name).toBe('test-template');
      expect(template.subject).toBe('Test Subject');
    });
  });

  describe('templates.list', () => {
    it('should list all templates', async () => {
      mockSend.mockResolvedValue({
        TemplatesMetadata: [
          {
            Name: 'template-1',
            Subject: 'Subject 1',
            CreatedTimestamp: new Date(),
          },
          {
            Name: 'template-2',
            Subject: 'Subject 2',
            CreatedTimestamp: new Date(),
          },
        ],
      });

      const templates = await email.templates.list();

      expect(templates).toHaveLength(2);
      expect(templates[0].name).toBe('template-1');
    });
  });

  describe('templates.delete', () => {
    it('should delete a template', async () => {
      mockSend.mockResolvedValue({});

      await email.templates.delete('test-template');

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('should destroy the SES client', () => {
      const mockDestroy = (email as any).sesClient.destroy;
      email.destroy();

      expect(mockDestroy).toHaveBeenCalled();
    });
  });
});

describe('WrapsEmail reply threading', () => {
  let email: WrapsEmail;
  let mockSend: any;

  function ssmValue(byte: number): string {
    const secret = Buffer.alloc(32, byte);
    return JSON.stringify({ kid: 1, current: secret.toString('base64') });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSsmSend.mockReset();
    email = new WrapsEmail({
      region: 'us-east-1',
      replyThreading: {
        parameterPrefix: '/wraps/email/reply-secret/',
        ssmClient: mockSsmClient,
      },
    });
    mockSend = (email as any).sesClient.send;
  });

  it('signs reply-to with r.mail.{fromDomain} when conversationId is set', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: ssmValue(0x11) } });
    mockSend.mockResolvedValue({
      MessageId: 'm-1',
      $metadata: { requestId: 'r-1' },
    });

    const convId = 'AAAAAAAAAAA';
    const result = await email.send({
      from: 'agent@support.foo.com',
      to: 'user@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      conversationId: convId,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.ReplyToAddresses).toHaveLength(1);
    expect(command.ReplyToAddresses[0]).toMatch(/@r\.mail\.support\.foo\.com$/);
    expect(result.conversationId).toBe(convId);
    expect(result.sendId).toBeDefined();
    expect(result.messageId).toBe('m-1');
  });

  it('signs per-domain correctly when two sends use different From domains', async () => {
    mockSsmSend.mockImplementation((cmd: any) => {
      const name = cmd?.input?.Name ?? cmd?.Name;
      if (name === '/wraps/email/reply-secret/support.foo.com') {
        return Promise.resolve({ Parameter: { Value: ssmValue(0x22) } });
      }
      if (name === '/wraps/email/reply-secret/sales.foo.com') {
        return Promise.resolve({ Parameter: { Value: ssmValue(0x33) } });
      }
      return Promise.reject(new Error(`unexpected ${name}`));
    });
    mockSend.mockResolvedValue({
      MessageId: 'm-2',
      $metadata: { requestId: 'r-2' },
    });

    await email.send({
      from: 'a@support.foo.com',
      to: 'u@example.com',
      subject: 's',
      html: '<p/>',
      conversationId: 'BBBBBBBBBBB',
    });
    await email.send({
      from: 'b@sales.foo.com',
      to: 'u@example.com',
      subject: 's',
      html: '<p/>',
      conversationId: 'CCCCCCCCCCC',
    });

    const cmds = mockSend.mock.calls.map((c: any[]) => c[0]);
    expect(cmds[0].ReplyToAddresses[0]).toMatch(/@r\.mail\.support\.foo\.com$/);
    expect(cmds[1].ReplyToAddresses[0]).toMatch(/@r\.mail\.sales\.foo\.com$/);
  });

  it('throws ValidationError when both replyTo and conversationId are set', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: ssmValue(0x44) } });
    mockSend.mockResolvedValue({
      MessageId: 'm-3',
      $metadata: { requestId: 'r-3' },
    });

    await expect(
      email.send({
        from: 'a@foo.com',
        to: 'u@example.com',
        subject: 's',
        html: '<p/>',
        replyTo: 'x@y.com',
        conversationId: 'DDDDDDDDDDD',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('returns { conversationId, sendId } from send() when signed', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: ssmValue(0x55) } });
    mockSend.mockResolvedValue({
      MessageId: 'm-4',
      $metadata: { requestId: 'r-4' },
    });

    const convId = 'EEEEEEEEEEE';
    const result = await email.send({
      from: 'a@foo.com',
      to: 'u@example.com',
      subject: 's',
      html: '<p/>',
      conversationId: convId,
    });

    expect(result.conversationId).toBe(convId);
    expect(result.sendId).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(result.messageId).toBe('m-4');
    expect(result.requestId).toBe('r-4');
  });

  it('sendTemplate signs reply-to when conversationId is passed', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: ssmValue(0x66) } });
    mockSend.mockResolvedValue({
      MessageId: 'tm-1',
      $metadata: { requestId: 'tr-1' },
    });

    const convId = 'FFFFFFFFFFF';
    const result = await email.sendTemplate({
      from: 'a@foo.com',
      to: 'u@example.com',
      template: 't',
      templateData: {},
      conversationId: convId,
    });

    const command = mockSend.mock.calls[0][0];
    expect(command.ReplyToAddresses[0]).toMatch(/@r\.mail\.foo\.com$/);
    expect(result.conversationId).toBe(convId);
    expect(result.sendId).toBeDefined();
  });

  it('sendBulkTemplate signs reply-to when conversationId is passed', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: ssmValue(0x77) } });
    mockSend.mockResolvedValue({
      Status: [{ MessageId: 'bm-1', Status: 'success' }],
      $metadata: { requestId: 'br-1' },
    });

    const convId = 'GGGGGGGGGGG';
    const result = await email.sendBulkTemplate({
      from: 'a@foo.com',
      template: 't',
      destinations: [{ to: 'u@example.com', templateData: {} }],
      conversationId: convId,
    });

    const command = mockSend.mock.calls[0][0];
    expect(command.ReplyToAddresses[0]).toMatch(/@r\.mail\.foo\.com$/);
    expect(result.conversationId).toBe(convId);
    expect(result.sendId).toBeDefined();
  });

  it('sendWithAttachments signs reply-to via raw MIME Reply-To header when conversationId is passed', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: ssmValue(0x88) } });
    mockSend.mockResolvedValue({
      MessageId: 'am-1',
      $metadata: { requestId: 'ar-1' },
    });

    const convId = 'HHHHHHHHHHH';
    const result = await email.send({
      from: 'a@foo.com',
      to: 'u@example.com',
      subject: 's',
      html: '<p/>',
      attachments: [{ filename: 't.txt', content: Buffer.from('hi') }],
      conversationId: convId,
    });

    const command = mockSend.mock.calls[0][0];
    expect(command).toHaveProperty('RawMessage');
    const rawMime = new TextDecoder().decode(command.RawMessage.Data as Uint8Array);
    expect(rawMime).toMatch(/Reply-To:.*@r\.mail\.foo\.com/);
    expect(result.conversationId).toBe(convId);
    expect(result.sendId).toBeDefined();
  });
});
