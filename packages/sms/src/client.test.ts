import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the entire AWS SDK module before imports
const mockSend = vi.fn();
const mockDestroy = vi.fn();

vi.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => ({
  PinpointSMSVoiceV2Client: class MockClient {
    send = mockSend;
    destroy = mockDestroy;
  },
  SendTextMessageCommand: class MockCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  DescribePhoneNumbersCommand: class MockCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  DescribeOptedOutNumbersCommand: class MockCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  PutOptedOutNumberCommand: class MockCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  DeleteOptedOutNumberCommand: class MockCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

// Import after mocking
import { WrapsSMS } from './client';
import { SMSError, ValidationError } from './errors';
import { calculateSegments, validatePhoneNumber } from './utils/validation';

describe('WrapsSMS', () => {
  let sms: WrapsSMS;

  beforeEach(() => {
    vi.clearAllMocks();
    sms = new WrapsSMS();
  });

  afterEach(() => {
    sms.destroy();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(sms).toBeInstanceOf(WrapsSMS);
    });

    it('should create instance with custom region', () => {
      const customSms = new WrapsSMS({ region: 'us-west-2' });
      expect(customSms).toBeInstanceOf(WrapsSMS);
      customSms.destroy();
    });
  });

  describe('send()', () => {
    it('should send a message successfully', async () => {
      mockSend.mockResolvedValueOnce({
        MessageId: 'msg-123',
        $metadata: { requestId: 'req-123' },
      });

      const result = await sms.send({
        to: '+14155551234',
        message: 'Hello, world!',
      });

      expect(result.messageId).toBe('msg-123');
      expect(result.status).toBe('QUEUED');
      expect(result.to).toBe('+14155551234');
      expect(result.segments).toBe(1);
    });

    it('should handle dry run mode', async () => {
      const result = await sms.send({
        to: '+14155551234',
        message: 'Test message',
        dryRun: true,
      });

      expect(result.messageId).toMatch(/^dry-run-/);
      expect(result.status).toBe('QUEUED');
      expect(result.segments).toBe(1);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw ValidationError for missing "to" field', async () => {
      await expect(
        sms.send({
          to: '',
          message: 'Hello',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for missing "message" field', async () => {
      await expect(
        sms.send({
          to: '+14155551234',
          message: '',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid phone number format', async () => {
      await expect(
        sms.send({
          to: '4155551234', // Missing + prefix
          message: 'Hello',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for message exceeding max length', async () => {
      const longMessage = 'a'.repeat(1601);

      await expect(
        sms.send({
          to: '+14155551234',
          message: longMessage,
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should calculate segments correctly for short messages', async () => {
      mockSend.mockResolvedValueOnce({
        MessageId: 'msg-123',
        $metadata: { requestId: 'req-123' },
      });

      const result = await sms.send({
        to: '+14155551234',
        message: 'Short message',
      });

      expect(result.segments).toBe(1);
    });

    it('should calculate segments correctly for long messages', async () => {
      mockSend.mockResolvedValueOnce({
        MessageId: 'msg-123',
        $metadata: { requestId: 'req-123' },
      });

      const longMessage = 'a'.repeat(200); // More than 160 chars
      const result = await sms.send({
        to: '+14155551234',
        message: longMessage,
      });

      expect(result.segments).toBe(2); // ceil(200/153) = 2
    });

    it('should handle AWS SDK errors', async () => {
      mockSend.mockRejectedValueOnce({
        name: 'ThrottlingException',
        message: 'Rate exceeded',
        $metadata: { requestId: 'req-123' },
        $retryable: { throttling: true },
      });

      await expect(
        sms.send({
          to: '+14155551234',
          message: 'Hello',
        })
      ).rejects.toThrow(SMSError);
    });
  });

  describe('sendBatch()', () => {
    it('should send batch messages successfully', async () => {
      mockSend
        .mockResolvedValueOnce({ MessageId: 'msg-1' })
        .mockResolvedValueOnce({ MessageId: 'msg-2' });

      const result = await sms.sendBatch({
        messages: [
          { to: '+14155551234', message: 'Hello 1' },
          { to: '+14155555678', message: 'Hello 2' },
        ],
      });

      expect(result.total).toBe(2);
      expect(result.queued).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(2);
    });

    it('should handle partial failures in batch', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-1' }).mockRejectedValueOnce({
        name: 'ValidationException',
        message: 'Invalid number',
        $metadata: { requestId: 'req-123' },
      });

      const result = await sms.sendBatch({
        messages: [
          { to: '+14155551234', message: 'Hello 1' },
          { to: '+14155555678', message: 'Hello 2' },
        ],
      });

      expect(result.total).toBe(2);
      expect(result.queued).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('should throw ValidationError for empty messages array', async () => {
      await expect(
        sms.sendBatch({
          messages: [],
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('numbers namespace', () => {
    it('should list phone numbers', async () => {
      mockSend.mockResolvedValueOnce({
        PhoneNumbers: [
          {
            PhoneNumberId: 'pn-123',
            PhoneNumber: '+18005551234',
            NumberType: 'TOLL_FREE',
            MessageType: 'TRANSACTIONAL',
            TwoWayEnabled: false,
            IsoCountryCode: 'US',
          },
        ],
      });

      const numbers = await sms.numbers.list();

      expect(numbers).toHaveLength(1);
      expect(numbers[0].phoneNumber).toBe('+18005551234');
      expect(numbers[0].numberType).toBe('TOLL_FREE');
    });

    it('should get a specific phone number', async () => {
      mockSend.mockResolvedValueOnce({
        PhoneNumbers: [
          {
            PhoneNumberId: 'pn-123',
            PhoneNumber: '+18005551234',
            NumberType: 'TOLL_FREE',
            MessageType: 'TRANSACTIONAL',
            TwoWayEnabled: true,
            IsoCountryCode: 'US',
          },
        ],
      });

      const number = await sms.numbers.get('pn-123');

      expect(number).toBeDefined();
      expect(number?.phoneNumber).toBe('+18005551234');
      expect(number?.twoWayEnabled).toBe(true);
    });
  });

  describe('optOuts namespace', () => {
    it('should check if a number is opted out', async () => {
      mockSend.mockResolvedValueOnce({
        OptedOutNumbers: [{ OptedOutNumber: '+14155551234' }],
      });

      const isOptedOut = await sms.optOuts.check('+14155551234');

      expect(isOptedOut).toBe(true);
    });

    it('should return false for non-opted-out numbers', async () => {
      mockSend.mockResolvedValueOnce({
        OptedOutNumbers: [],
      });

      const isOptedOut = await sms.optOuts.check('+14155551234');

      expect(isOptedOut).toBe(false);
    });

    it('should add a number to opt-out list', async () => {
      mockSend.mockResolvedValueOnce({});

      await expect(sms.optOuts.add('+14155551234')).resolves.not.toThrow();
    });

    it('should remove a number from opt-out list', async () => {
      mockSend.mockResolvedValueOnce({});

      await expect(sms.optOuts.remove('+14155551234')).resolves.not.toThrow();
    });
  });
});

describe('validation utilities', () => {
  describe('calculateSegments', () => {
    it('should return 1 for short GSM-7 messages', () => {
      expect(calculateSegments('Hello')).toBe(1);
      expect(calculateSegments('a'.repeat(160))).toBe(1);
    });

    it('should return 2 for messages over 160 chars', () => {
      expect(calculateSegments('a'.repeat(161))).toBe(2);
      expect(calculateSegments('a'.repeat(306))).toBe(2);
    });

    it('should return 3 for messages over 306 chars', () => {
      expect(calculateSegments('a'.repeat(307))).toBe(3);
    });
  });

  describe('validatePhoneNumber', () => {
    it('should accept valid E.164 phone numbers', () => {
      expect(() => validatePhoneNumber('+14155551234', 'to')).not.toThrow();
      expect(() => validatePhoneNumber('+442071234567', 'to')).not.toThrow();
      expect(() => validatePhoneNumber('+8613800138000', 'to')).not.toThrow();
    });

    it('should reject invalid phone number formats', () => {
      // Missing + prefix
      expect(() => validatePhoneNumber('14155551234', 'to')).toThrow(ValidationError);

      // Contains letters
      expect(() => validatePhoneNumber('+1415555CALL', 'to')).toThrow(ValidationError);

      // Too short
      expect(() => validatePhoneNumber('+1', 'to')).toThrow(ValidationError);

      // Starts with 0 after +
      expect(() => validatePhoneNumber('+014155551234', 'to')).toThrow(ValidationError);
    });
  });
});
