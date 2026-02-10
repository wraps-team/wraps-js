import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESError, ValidationError } from './errors';
import { WrapsEmailSuppression } from './suppression';

// Mock the command constructors to just pass through input
vi.mock('@aws-sdk/client-sesv2', () => ({
  GetSuppressedDestinationCommand: vi.fn(function (this: any, input: any) {
    Object.assign(this, input);
  }),
  PutSuppressedDestinationCommand: vi.fn(function (this: any, input: any) {
    Object.assign(this, input);
  }),
  DeleteSuppressedDestinationCommand: vi.fn(function (this: any, input: any) {
    Object.assign(this, input);
  }),
  ListSuppressedDestinationsCommand: vi.fn(function (this: any, input: any) {
    Object.assign(this, input);
  }),
}));

describe('WrapsEmailSuppression', () => {
  let suppression: WrapsEmailSuppression;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    // Pass a mock client directly — no need to mock SESv2Client construction
    const mockClient = { send: mockSend, destroy: vi.fn() } as any;
    suppression = new WrapsEmailSuppression(mockClient);
  });

  describe('get', () => {
    it('should return SuppressionEntry when email is suppressed', async () => {
      const lastUpdateTime = new Date('2024-06-15T10:00:00Z');
      mockSend.mockResolvedValue({
        SuppressedDestination: {
          EmailAddress: 'bounced@example.com',
          Reason: 'BOUNCE',
          LastUpdateTime: lastUpdateTime,
          Attributes: {
            MessageId: 'msg-abc',
            FeedbackId: 'fb-123',
          },
        },
      });

      const result = await suppression.get('bounced@example.com');

      expect(result).not.toBeNull();
      expect(result!.email).toBe('bounced@example.com');
      expect(result!.reason).toBe('BOUNCE');
      expect(result!.lastUpdated).toBe(lastUpdateTime);
      expect(result!.messageId).toBe('msg-abc');
      expect(result!.feedbackId).toBe('fb-123');
    });

    it('should return null when NotFoundException (not suppressed)', async () => {
      mockSend.mockRejectedValue({
        name: 'NotFoundException',
        message: 'Not found',
        $metadata: { requestId: 'req-1' },
      });

      const result = await suppression.get('clean@example.com');
      expect(result).toBeNull();
    });

    it('should throw SESError on other errors', async () => {
      mockSend.mockRejectedValue({
        name: 'BadRequestException',
        message: 'Invalid email',
        $metadata: { requestId: 'req-2' },
      });

      await expect(suppression.get('invalid')).rejects.toThrow(SESError);
    });

    it('should validate email is non-empty', async () => {
      await expect(suppression.get('')).rejects.toThrow(ValidationError);
    });
  });

  describe('add', () => {
    it('should send PutSuppressedDestinationCommand with correct params', async () => {
      mockSend.mockResolvedValue({});

      await suppression.add('spam@example.com', 'COMPLAINT');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.EmailAddress).toBe('spam@example.com');
      expect(command.Reason).toBe('COMPLAINT');
    });

    it('should validate reason is BOUNCE or COMPLAINT', async () => {
      await expect(suppression.add('test@example.com', 'INVALID' as any)).rejects.toThrow(
        ValidationError,
      );
    });

    it('should validate email is non-empty', async () => {
      await expect(suppression.add('', 'BOUNCE')).rejects.toThrow(ValidationError);
    });

    it('should throw SESError on API errors', async () => {
      mockSend.mockRejectedValue({
        name: 'TooManyRequestsException',
        message: 'Rate limit exceeded',
        $metadata: { requestId: 'req-3' },
        $retryable: { throttling: true },
      });

      await expect(suppression.add('test@example.com', 'BOUNCE')).rejects.toThrow(SESError);
    });
  });

  describe('remove', () => {
    it('should send DeleteSuppressedDestinationCommand', async () => {
      mockSend.mockResolvedValue({});

      await suppression.remove('restored@example.com');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.EmailAddress).toBe('restored@example.com');
    });

    it('should silently succeed on NotFoundException (idempotent)', async () => {
      mockSend.mockRejectedValue({
        name: 'NotFoundException',
        message: 'Not found',
        $metadata: { requestId: 'req-4' },
      });

      await expect(suppression.remove('nonexistent@example.com')).resolves.toBeUndefined();
    });

    it('should throw SESError on other errors', async () => {
      mockSend.mockRejectedValue({
        name: 'BadRequestException',
        message: 'Bad request',
        $metadata: { requestId: 'req-5' },
      });

      await expect(suppression.remove('test@example.com')).rejects.toThrow(SESError);
    });

    it('should validate email is non-empty', async () => {
      await expect(suppression.remove('')).rejects.toThrow(ValidationError);
    });
  });

  describe('list', () => {
    it('should return paginated results with nextToken', async () => {
      mockSend.mockResolvedValue({
        SuppressedDestinationSummaries: [
          {
            EmailAddress: 'bounced1@example.com',
            Reason: 'BOUNCE',
            LastUpdateTime: new Date('2024-06-01'),
          },
          {
            EmailAddress: 'complained1@example.com',
            Reason: 'COMPLAINT',
            LastUpdateTime: new Date('2024-06-10'),
          },
        ],
        NextToken: 'next-page-token',
      });

      const result = await suppression.list();

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].email).toBe('bounced1@example.com');
      expect(result.entries[0].reason).toBe('BOUNCE');
      expect(result.entries[1].email).toBe('complained1@example.com');
      expect(result.entries[1].reason).toBe('COMPLAINT');
      expect(result.nextToken).toBe('next-page-token');
    });

    it('should filter by reason', async () => {
      mockSend.mockResolvedValue({
        SuppressedDestinationSummaries: [],
      });

      await suppression.list({ reason: 'BOUNCE' });

      const command = mockSend.mock.calls[0][0];
      expect(command.Reasons).toEqual(['BOUNCE']);
    });

    it('should filter by date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-06-30');

      mockSend.mockResolvedValue({
        SuppressedDestinationSummaries: [],
      });

      await suppression.list({ startDate, endDate });

      const command = mockSend.mock.calls[0][0];
      expect(command.StartDate).toBe(startDate);
      expect(command.EndDate).toBe(endDate);
    });

    it('should return empty result when no entries', async () => {
      mockSend.mockResolvedValue({
        SuppressedDestinationSummaries: [],
      });

      const result = await suppression.list();

      expect(result.entries).toHaveLength(0);
      expect(result.nextToken).toBeUndefined();
    });

    it('should pass through continuationToken as NextToken', async () => {
      mockSend.mockResolvedValue({
        SuppressedDestinationSummaries: [],
      });

      await suppression.list({ continuationToken: 'page-2-token' });

      const command = mockSend.mock.calls[0][0];
      expect(command.NextToken).toBe('page-2-token');
    });

    it('should use custom maxResults', async () => {
      mockSend.mockResolvedValue({
        SuppressedDestinationSummaries: [],
      });

      await suppression.list({ maxResults: 500 });

      const command = mockSend.mock.calls[0][0];
      expect(command.PageSize).toBe(500);
    });
  });
});
