import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WrapsEmail } from './client';
import { SESClient } from '@aws-sdk/client-ses';
import { ValidationError, SESError } from './errors';

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
  normalizeEmailAddress: vi.fn((addr) =>
    typeof addr === 'string' ? addr : addr.email
  ),
  normalizeEmailAddresses: vi.fn((addrs) =>
    Array.isArray(addrs) ? addrs : [addrs]
  ),
}));

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

    it('should throw error for attachments (not implemented)', async () => {
      await expect(
        email.send({
          from: 'sender@example.com',
          to: 'recipient@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
          attachments: [
            {
              filename: 'test.pdf',
              content: Buffer.from('test'),
            },
          ],
        })
      ).rejects.toThrow('Attachments support coming soon');
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
        Status: [
          { MessageId: 'msg-1', Status: 'success' },
        ],
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
