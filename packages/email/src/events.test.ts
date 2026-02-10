import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynamoDBError, ValidationError } from './errors';
import { WrapsEmailEvents } from './events';

// Mock the QueryCommand to just pass through input
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (this: any, input: any) {
    Object.assign(this, input);
  }),
}));

describe('WrapsEmailEvents', () => {
  let events: WrapsEmailEvents;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    // Pass a mock client directly — no need to mock DynamoDBDocumentClient construction
    const mockClient = { send: mockSend, destroy: vi.fn() } as any;
    events = new WrapsEmailEvents(mockClient, 'wraps-email-history');
  });

  describe('get', () => {
    it('should return aggregated status for messageId with multiple events', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            messageId: 'msg-123',
            sentAt: 1700000000000,
            from: 'sender@example.com',
            to: ['user@example.com'],
            subject: 'Hello',
            eventType: 'Send',
            additionalData: '{"source":"ses"}',
          },
          {
            messageId: 'msg-123',
            sentAt: 1700000001000,
            from: 'sender@example.com',
            to: ['user@example.com'],
            subject: 'Hello',
            eventType: 'Delivery',
            additionalData: '{"smtpResponse":"250 OK"}',
          },
          {
            messageId: 'msg-123',
            sentAt: 1700000005000,
            from: 'sender@example.com',
            to: ['user@example.com'],
            subject: 'Hello',
            eventType: 'Open',
            additionalData: '{"ipAddress":"1.2.3.4"}',
          },
        ],
        $metadata: { requestId: 'req-1' },
      });

      const result = await events.get('msg-123');

      expect(result).not.toBeNull();
      expect(result!.messageId).toBe('msg-123');
      expect(result!.from).toBe('sender@example.com');
      expect(result!.to).toEqual(['user@example.com']);
      expect(result!.subject).toBe('Hello');
      expect(result!.status).toBe('opened');
      expect(result!.sentAt).toBe(1700000000000);
      expect(result!.lastEventAt).toBe(1700000005000);
      expect(result!.events).toHaveLength(3);
      expect(result!.events[0].type).toBe('send');
      expect(result!.events[1].type).toBe('delivery');
      expect(result!.events[2].type).toBe('open');
      expect(result!.events[2].metadata).toEqual({ ipAddress: '1.2.3.4' });
    });

    it('should return null when no items found', async () => {
      mockSend.mockResolvedValue({
        Items: [],
        $metadata: { requestId: 'req-2' },
      });

      const result = await events.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should throw DynamoDBError on ResourceNotFoundException', async () => {
      mockSend.mockRejectedValue({
        message: 'Table not found',
        name: 'ResourceNotFoundException',
        $metadata: { requestId: 'req-3' },
      });

      await expect(events.get('msg-123')).rejects.toThrow(DynamoDBError);
    });

    it('should validate messageId is non-empty', async () => {
      await expect(events.get('')).rejects.toThrow(ValidationError);
    });

    it('should handle bounce overriding positive status', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            messageId: 'msg-bounce',
            sentAt: 1700000000000,
            from: 'sender@example.com',
            to: ['user@example.com'],
            subject: 'Test',
            eventType: 'Send',
            additionalData: '{}',
          },
          {
            messageId: 'msg-bounce',
            sentAt: 1700000001000,
            from: 'sender@example.com',
            to: ['user@example.com'],
            subject: 'Test',
            eventType: 'Bounce',
            additionalData: '{"bounceType":"Permanent"}',
          },
        ],
        $metadata: { requestId: 'req-4' },
      });

      const result = await events.get('msg-bounce');
      expect(result!.status).toBe('bounced');
    });

    it('should handle complaint overriding delivered status', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            messageId: 'msg-complaint',
            sentAt: 1700000000000,
            from: 'sender@example.com',
            to: ['user@example.com'],
            subject: 'Test',
            eventType: 'Send',
            additionalData: '{}',
          },
          {
            messageId: 'msg-complaint',
            sentAt: 1700000001000,
            from: 'sender@example.com',
            to: ['user@example.com'],
            subject: 'Test',
            eventType: 'Delivery',
            additionalData: '{}',
          },
          {
            messageId: 'msg-complaint',
            sentAt: 1700000010000,
            from: 'sender@example.com',
            to: ['user@example.com'],
            subject: 'Test',
            eventType: 'Complaint',
            additionalData: '{"complaintFeedbackType":"abuse"}',
          },
        ],
        $metadata: { requestId: 'req-5' },
      });

      const result = await events.get('msg-complaint');
      expect(result!.status).toBe('complained');
    });

    it('should handle suppressed event type', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            messageId: 'msg-suppressed',
            sentAt: 1700000000000,
            from: 'sender@example.com',
            to: ['user@example.com'],
            subject: 'Test',
            eventType: 'Suppressed',
            additionalData: '{}',
          },
        ],
        $metadata: { requestId: 'req-6' },
      });

      const result = await events.get('msg-suppressed');
      expect(result!.status).toBe('suppressed');
    });

    it('should handle items with invalid additionalData gracefully', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            messageId: 'msg-bad-json',
            sentAt: 1700000000000,
            from: 'sender@example.com',
            to: ['user@example.com'],
            subject: 'Test',
            eventType: 'Send',
            additionalData: 'not-json',
          },
        ],
        $metadata: { requestId: 'req-7' },
      });

      const result = await events.get('msg-bad-json');
      expect(result).not.toBeNull();
      expect(result!.events[0].metadata).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should query GSI with accountId and return paginated results', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            messageId: 'msg-1',
            sentAt: 1700000005000,
            accountId: '123456789012',
            from: 'sender@example.com',
            to: ['user1@example.com'],
            subject: 'Email 1',
            eventType: 'Delivery',
            additionalData: '{}',
          },
          {
            messageId: 'msg-2',
            sentAt: 1700000003000,
            accountId: '123456789012',
            from: 'sender@example.com',
            to: ['user2@example.com'],
            subject: 'Email 2',
            eventType: 'Send',
            additionalData: '{}',
          },
        ],
        LastEvaluatedKey: { messageId: 'msg-2', sentAt: 1700000003000 },
        $metadata: { requestId: 'req-list-1' },
      });

      const result = await events.list({ accountId: '123456789012' });

      expect(result.emails).toHaveLength(2);
      expect(result.nextToken).toBeDefined();

      // Verify base64 encoded token
      const decoded = JSON.parse(Buffer.from(result.nextToken!, 'base64').toString('utf-8'));
      expect(decoded).toEqual({ messageId: 'msg-2', sentAt: 1700000003000 });
    });

    it('should handle continuationToken (base64 decode)', async () => {
      const token = Buffer.from(
        JSON.stringify({ messageId: 'msg-prev', sentAt: 1700000000000 }),
      ).toString('base64');

      mockSend.mockResolvedValue({
        Items: [],
        $metadata: { requestId: 'req-list-2' },
      });

      await events.list({ accountId: '123456789012', continuationToken: token });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.ExclusiveStartKey).toEqual({
        messageId: 'msg-prev',
        sentAt: 1700000000000,
      });
    });

    it('should return empty result when no items', async () => {
      mockSend.mockResolvedValue({
        Items: [],
        $metadata: { requestId: 'req-list-3' },
      });

      const result = await events.list({ accountId: '123456789012' });

      expect(result.emails).toHaveLength(0);
      expect(result.nextToken).toBeUndefined();
    });

    it('should apply startTime and endTime filters', async () => {
      mockSend.mockResolvedValue({
        Items: [],
        $metadata: { requestId: 'req-list-4' },
      });

      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-01-31');

      await events.list({ accountId: '123456789012', startTime, endTime });

      const command = mockSend.mock.calls[0][0];
      expect(command.KeyConditionExpression).toContain('BETWEEN');
      expect(command.ExpressionAttributeValues[':start']).toBe(startTime.getTime());
      expect(command.ExpressionAttributeValues[':end']).toBe(endTime.getTime());
    });

    it('should apply startTime only filter', async () => {
      mockSend.mockResolvedValue({
        Items: [],
        $metadata: { requestId: 'req-list-5' },
      });

      const startTime = new Date('2024-01-01');

      await events.list({ accountId: '123456789012', startTime });

      const command = mockSend.mock.calls[0][0];
      expect(command.KeyConditionExpression).toContain('>= :start');
    });

    it('should validate accountId is required', async () => {
      await expect(events.list({ accountId: '' })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid continuation token', async () => {
      await expect(
        events.list({ accountId: '123456789012', continuationToken: 'not-valid-base64!@#' }),
      ).rejects.toThrow(ValidationError);
    });

    it('should group items by messageId correctly', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            messageId: 'msg-a',
            sentAt: 1700000005000,
            accountId: '123456789012',
            from: 'sender@example.com',
            to: ['user1@example.com'],
            subject: 'Email A',
            eventType: 'Delivery',
            additionalData: '{}',
          },
          {
            messageId: 'msg-a',
            sentAt: 1700000003000,
            accountId: '123456789012',
            from: 'sender@example.com',
            to: ['user1@example.com'],
            subject: 'Email A',
            eventType: 'Send',
            additionalData: '{}',
          },
          {
            messageId: 'msg-b',
            sentAt: 1700000004000,
            accountId: '123456789012',
            from: 'sender@example.com',
            to: ['user2@example.com'],
            subject: 'Email B',
            eventType: 'Send',
            additionalData: '{}',
          },
        ],
        $metadata: { requestId: 'req-list-6' },
      });

      const result = await events.list({ accountId: '123456789012' });

      expect(result.emails).toHaveLength(2);

      const emailA = result.emails.find((e) => e.messageId === 'msg-a');
      expect(emailA).toBeDefined();
      expect(emailA!.events).toHaveLength(2);
      expect(emailA!.status).toBe('delivered');

      const emailB = result.emails.find((e) => e.messageId === 'msg-b');
      expect(emailB).toBeDefined();
      expect(emailB!.events).toHaveLength(1);
      expect(emailB!.status).toBe('sent');
    });
  });
});
