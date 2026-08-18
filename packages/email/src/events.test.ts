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
      expect(result?.messageId).toBe('msg-123');
      expect(result?.from).toBe('sender@example.com');
      expect(result?.to).toEqual(['user@example.com']);
      expect(result?.subject).toBe('Hello');
      expect(result?.status).toBe('opened');
      expect(result?.sentAt).toBe(1700000000000);
      expect(result?.lastEventAt).toBe(1700000005000);
      expect(result?.events).toHaveLength(3);
      expect(result?.events[0].type).toBe('send');
      expect(result?.events[1].type).toBe('delivery');
      expect(result?.events[2].type).toBe('open');
      expect(result?.events[2].metadata).toEqual({ ipAddress: '1.2.3.4' });
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
      expect(result?.status).toBe('bounced');
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
      expect(result?.status).toBe('complained');
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
      expect(result?.status).toBe('suppressed');
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
      expect(result?.events[0].metadata).toBeUndefined();
    });
  });

  describe('list', () => {
    type Row = {
      messageId: string;
      sentAt: number;
      eventType: string;
      accountId?: string;
      from?: string;
      to?: string[];
      subject?: string;
      additionalData?: string;
    };

    /**
     * Stands in for the real table: one row per event, a GSI paged newest-first
     * with a hard Limit, and a base-table partition read per messageId. The
     * defects this suite guards against only appear when the GSI window cuts a
     * message's event set in half, so the mock has to page for real.
     */
    function seedTable(rows: Row[]): { gsiQueries: any[]; baseQueries: any[] } {
      const gsiQueries: any[] = [];
      const baseQueries: any[] = [];

      mockSend.mockImplementation(async (command: any) => {
        if (command.IndexName) {
          gsiQueries.push(command);
          const descending = [...rows].sort((a, b) => b.sentAt - a.sentAt);
          let start = 0;
          if (command.ExclusiveStartKey) {
            start = descending.findIndex(
              (row) =>
                row.messageId === command.ExclusiveStartKey.messageId &&
                row.sentAt === command.ExclusiveStartKey.sentAt
            );
          }
          const page = descending.slice(start, start + command.Limit);
          const last = descending[start + command.Limit];
          return {
            Items: page,
            LastEvaluatedKey: last
              ? { messageId: last.messageId, sentAt: last.sentAt, accountId: last.accountId }
              : undefined,
            $metadata: { requestId: 'req-gsi' },
          };
        }

        baseQueries.push(command);
        const messageId = command.ExpressionAttributeValues[':mid'];
        return {
          Items: rows
            .filter((row) => row.messageId === messageId)
            .sort((a, b) => a.sentAt - b.sentAt),
          $metadata: { requestId: 'req-base' },
        };
      });

      return { gsiQueries, baseQueries };
    }

    function messageRows(messageId: string, sendAt: number, extraEventOffsets: number[]): Row[] {
      const base = {
        messageId,
        accountId: '123456789012',
        from: 'sender@example.com',
        to: [`${messageId}@example.com`],
        subject: `Subject ${messageId}`,
        additionalData: '{}',
      };
      return [
        { ...base, sentAt: sendAt, eventType: 'Send' },
        ...extraEventOffsets.map((offset) => ({
          ...base,
          sentAt: sendAt + offset,
          eventType: 'Open',
        })),
      ];
    }

    it('bounds maxResults by messages, not by event rows', async () => {
      // 10 messages x 3 events each. The old implementation passed maxResults
      // straight through as the DynamoDB item Limit, so asking for 5 messages
      // returned 5 event rows grouped into 2.
      const rows = Array.from({ length: 10 }, (_, i) =>
        messageRows(`msg-${i}`, 1_700_000_000_000 + i * 10_000, [1000, 2000])
      ).flat();
      seedTable(rows);

      const result = await events.list({ accountId: '123456789012', maxResults: 5 });

      expect(result.emails).toHaveLength(5);
    });

    it('returns every message when fewer exist than maxResults', async () => {
      seedTable(
        [
          messageRows('msg-a', 1_700_000_000_000, [500]),
          messageRows('msg-b', 1_700_000_010_000, [500]),
        ].flat()
      );

      const result = await events.list({ accountId: '123456789012', maxResults: 25 });

      expect(result.emails).toHaveLength(2);
      expect(result.nextToken).toBeUndefined();
    });

    it('orders results newest send first', async () => {
      // Deliberately interleaved: msg-old is the oldest send but has the most
      // recent open, which is what previously floated it to the top.
      seedTable(
        [
          messageRows('msg-old', 1_700_000_000_000, [900_000]),
          messageRows('msg-mid', 1_700_000_300_000, [1000]),
          messageRows('msg-new', 1_700_000_600_000, [1000]),
        ].flat()
      );

      const result = await events.list({ accountId: '123456789012', maxResults: 10 });

      expect(result.emails.map((email) => email.messageId)).toEqual([
        'msg-new',
        'msg-mid',
        'msg-old',
      ]);
      const timestamps = result.emails.map((email) => email.sentAt);
      expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
    });

    it('reports the same sentAt for a messageId regardless of maxResults', async () => {
      // The regression: with a small window the send row fell outside the scan
      // and sentAt became whichever open event landed inside it.
      const rows = Array.from({ length: 12 }, (_, i) =>
        messageRows(`msg-${i}`, 1_700_000_000_000 + i * 60_000, [10_000, 20_000, 30_000])
      ).flat();
      seedTable(rows);

      const small = await events.list({ accountId: '123456789012', maxResults: 3 });
      const large = await events.list({ accountId: '123456789012', maxResults: 12 });

      const target = small.emails[0].messageId;
      const fromSmall = small.emails.find((email) => email.messageId === target);
      const fromLarge = large.emails.find((email) => email.messageId === target);

      expect(fromLarge).toBeDefined();
      expect(fromSmall?.sentAt).toBe(fromLarge?.sentAt);
    });

    it('derives sentAt from the send event, not the earliest scanned event', async () => {
      seedTable(messageRows('msg-x', 1_700_000_000_000, [5000, 9000]));

      const result = await events.list({ accountId: '123456789012', maxResults: 10 });

      expect(result.emails[0].sentAt).toBe(1_700_000_000_000);
      expect(result.emails[0].lastEventAt).toBe(1_700_000_009_000);
      expect(result.emails[0].events).toHaveLength(3);
    });

    it('re-reads each message whole so events split across the scan window survive', async () => {
      const { baseQueries } = seedTable(
        [
          messageRows('msg-a', 1_700_000_000_000, [1000, 2000, 3000]),
          messageRows('msg-b', 1_700_000_500_000, [1000]),
        ].flat()
      );

      const result = await events.list({ accountId: '123456789012', maxResults: 2 });

      expect(baseQueries.map((q) => q.ExpressionAttributeValues[':mid']).sort()).toEqual([
        'msg-a',
        'msg-b',
      ]);
      expect(result.emails.find((e) => e.messageId === 'msg-a')?.events).toHaveLength(4);
    });

    it('pages the GSI when one scan does not surface enough messages', async () => {
      // 40 messages x 6 events = 240 rows; a single scan cannot reach 20 messages.
      const rows = Array.from({ length: 40 }, (_, i) =>
        messageRows(`msg-${i}`, 1_700_000_000_000 + i * 10_000, [1, 2, 3, 4, 5])
      ).flat();
      const { gsiQueries } = seedTable(rows);

      const result = await events.list({ accountId: '123456789012', maxResults: 20 });

      expect(result.emails).toHaveLength(20);
      expect(gsiQueries.length).toBeGreaterThan(1);
    });

    it('returns a continuation token that resumes without skipping or repeating', async () => {
      const rows = Array.from({ length: 6 }, (_, i) =>
        messageRows(`msg-${i}`, 1_700_000_000_000 + i * 10_000, [1000])
      ).flat();
      seedTable(rows);

      const page1 = await events.list({ accountId: '123456789012', maxResults: 4 });
      expect(page1.emails).toHaveLength(4);
      expect(page1.nextToken).toBeDefined();

      const page2 = await events.list({
        accountId: '123456789012',
        maxResults: 4,
        continuationToken: page1.nextToken,
      });

      const seen = [...page1.emails, ...page2.emails].map((email) => email.messageId);
      expect(new Set(seen).size).toBe(6);
      expect(page2.nextToken).toBeUndefined();
    });

    it('omits nextToken when the source is exhausted', async () => {
      seedTable(messageRows('msg-only', 1_700_000_000_000, [1000]));

      const result = await events.list({ accountId: '123456789012', maxResults: 50 });

      expect(result.nextToken).toBeUndefined();
    });

    it('should query the accountId-sentAt GSI newest-first', async () => {
      const { gsiQueries } = seedTable(messageRows('msg-a', 1_700_000_000_000, []));

      await events.list({ accountId: '123456789012' });

      expect(gsiQueries[0].IndexName).toBe('accountId-sentAt-index');
      expect(gsiQueries[0].ScanIndexForward).toBe(false);
      expect(gsiQueries[0].ExpressionAttributeValues[':aid']).toBe('123456789012');
    });

    it('should handle continuationToken (base64 decode)', async () => {
      const token = Buffer.from(
        JSON.stringify({ messageId: 'msg-prev', sentAt: 1700000000000 })
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
        events.list({ accountId: '123456789012', continuationToken: 'not-valid-base64!@#' })
      ).rejects.toThrow(ValidationError);
    });

    it('should group items by messageId correctly', async () => {
      seedTable(
        [
          messageRows('msg-a', 1_700_000_003_000, [2000]),
          messageRows('msg-b', 1_700_000_004_000, []),
        ]
          .flat()
          .map((row) =>
            row.messageId === 'msg-a' && row.eventType === 'Open'
              ? { ...row, eventType: 'Delivery' }
              : row
          )
      );

      const result = await events.list({ accountId: '123456789012' });

      expect(result.emails).toHaveLength(2);

      const emailA = result.emails.find((e) => e.messageId === 'msg-a');
      expect(emailA).toBeDefined();
      expect(emailA?.events).toHaveLength(2);
      expect(emailA?.status).toBe('delivered');

      const emailB = result.emails.find((e) => e.messageId === 'msg-b');
      expect(emailB).toBeDefined();
      expect(emailB?.events).toHaveLength(1);
      expect(emailB?.status).toBe('sent');
    });
  });
});
