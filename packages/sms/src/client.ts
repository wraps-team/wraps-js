import {
  DeleteOptedOutNumberCommand,
  DescribeOptedOutNumbersCommand,
  DescribePhoneNumbersCommand,
  type PinpointSMSVoiceV2Client,
  PutOptedOutNumberCommand,
  SendTextMessageCommand,
} from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { OptedOutError, SMSError } from './errors';
import type {
  BatchMessageResult,
  BatchOptions,
  BatchResult,
  OptOutEntry,
  PhoneNumber,
  SendOptions,
  SendResult,
  WrapsSMSConfig,
} from './types';
import { createSMSClient } from './utils/credentials';
import { calculateSegments, validateBatchOptions, validateSendOptions } from './utils/validation';

/**
 * WrapsSMS - Beautiful SMS SDK for AWS End User Messaging
 *
 * @example
 * ```typescript
 * import { WrapsSMS } from '@wraps.dev/sms';
 *
 * const sms = new WrapsSMS();
 *
 * const result = await sms.send({
 *   to: '+14155551234',
 *   message: 'Your verification code is 123456',
 * });
 * ```
 */
export class WrapsSMS {
  private smsClient: PinpointSMSVoiceV2Client;

  /**
   * Phone number management methods
   */
  public readonly numbers: {
    list: () => Promise<PhoneNumber[]>;
    get: (phoneNumberId: string) => Promise<PhoneNumber | undefined>;
  };

  /**
   * Opt-out list management methods
   */
  public readonly optOuts: {
    list: (optOutListName?: string) => Promise<OptOutEntry[]>;
    check: (phoneNumber: string, optOutListName?: string) => Promise<boolean>;
    add: (phoneNumber: string, optOutListName?: string) => Promise<void>;
    remove: (phoneNumber: string, optOutListName?: string) => Promise<void>;
  };

  constructor(config: WrapsSMSConfig = {}) {
    this.smsClient = createSMSClient(config);

    // Initialize numbers namespace
    this.numbers = {
      list: this.listPhoneNumbers.bind(this),
      get: this.getPhoneNumber.bind(this),
    };

    // Initialize optOuts namespace
    this.optOuts = {
      list: this.listOptOuts.bind(this),
      check: this.checkOptOut.bind(this),
      add: this.addOptOut.bind(this),
      remove: this.removeOptOut.bind(this),
    };
  }

  /**
   * Send a single SMS message
   *
   * @param options - Send options including recipient, message, and optional settings
   * @returns Promise resolving to send result with message ID and status
   *
   * @example
   * ```typescript
   * const result = await sms.send({
   *   to: '+14155551234',
   *   message: 'Your verification code is 123456',
   *   messageType: 'TRANSACTIONAL',
   * });
   *
   * console.log(result.messageId); // 'msg-abc123...'
   * ```
   */
  async send(options: SendOptions): Promise<SendResult> {
    // Validate parameters
    validateSendOptions(options);

    // Handle dry run
    if (options.dryRun) {
      return {
        messageId: `dry-run-${Date.now()}`,
        status: 'QUEUED',
        to: options.to,
        from: options.from || 'dry-run',
        segments: calculateSegments(options.message),
      };
    }

    // Build SendTextMessage command
    const command = new SendTextMessageCommand({
      DestinationPhoneNumber: options.to,
      MessageBody: options.message,
      MessageType: options.messageType || 'TRANSACTIONAL',
      OriginationIdentity: options.from,
      ConfigurationSetName: options.configurationSetName,
      MaxPrice: options.maxPrice,
      TimeToLive: options.ttl,
      Context: options.context,
    });

    try {
      const response = await this.smsClient.send(command);

      if (!response.MessageId) {
        throw new Error('Invalid response from SMS service: missing MessageId');
      }

      return {
        messageId: response.MessageId,
        status: 'QUEUED',
        to: options.to,
        from: options.from || 'default',
        segments: calculateSegments(options.message),
      };
    } catch (error) {
      throw this.handleSMSError(error);
    }
  }

  /**
   * Send SMS messages to multiple recipients
   *
   * @param options - Batch options including array of messages
   * @returns Promise resolving to batch result with individual message statuses
   *
   * @example
   * ```typescript
   * const result = await sms.sendBatch({
   *   messages: [
   *     { to: '+14155551234', message: 'Your order shipped!' },
   *     { to: '+14155555678', message: 'Your order shipped!' },
   *   ],
   *   messageType: 'TRANSACTIONAL',
   * });
   *
   * console.log(`Sent: ${result.queued}, Failed: ${result.failed}`);
   * ```
   */
  async sendBatch(options: BatchOptions): Promise<BatchResult> {
    // Validate parameters
    validateBatchOptions(options);

    const results: BatchMessageResult[] = [];
    let queued = 0;
    let failed = 0;

    // Send messages sequentially (AWS doesn't have a batch SMS API)
    // In Pro tier, this would use SQS for rate limiting
    for (const msg of options.messages) {
      try {
        const result = await this.send({
          to: msg.to,
          message: msg.message,
          from: options.from,
          messageType: options.messageType,
          context: msg.context,
          configurationSetName: options.configurationSetName,
        });

        results.push({
          to: msg.to,
          messageId: result.messageId,
          status: 'QUEUED',
        });
        queued++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          to: msg.to,
          status: 'FAILED',
          error: errorMessage,
        });
        failed++;
      }
    }

    return {
      batchId: `batch-${Date.now()}`,
      total: options.messages.length,
      queued,
      failed,
      results,
    };
  }

  /**
   * List all phone numbers in the account
   */
  private async listPhoneNumbers(): Promise<PhoneNumber[]> {
    try {
      const command = new DescribePhoneNumbersCommand({});
      const response = await this.smsClient.send(command);

      return (response.PhoneNumbers || []).map((pn) => ({
        phoneNumberId: pn.PhoneNumberId || '',
        phoneNumber: pn.PhoneNumber || '',
        numberType: pn.NumberType || '',
        messageType: (pn.MessageType as 'TRANSACTIONAL' | 'PROMOTIONAL') || 'TRANSACTIONAL',
        twoWayEnabled: pn.TwoWayEnabled || false,
        registrationStatus: pn.Status,
        isoCountryCode: pn.IsoCountryCode || '',
      }));
    } catch (error) {
      throw this.handleSMSError(error);
    }
  }

  /**
   * Get details for a specific phone number
   */
  private async getPhoneNumber(phoneNumberId: string): Promise<PhoneNumber | undefined> {
    try {
      const command = new DescribePhoneNumbersCommand({
        PhoneNumberIds: [phoneNumberId],
      });
      const response = await this.smsClient.send(command);

      const pn = response.PhoneNumbers?.[0];
      if (!pn) {
        return undefined;
      }

      return {
        phoneNumberId: pn.PhoneNumberId || '',
        phoneNumber: pn.PhoneNumber || '',
        numberType: pn.NumberType || '',
        messageType: (pn.MessageType as 'TRANSACTIONAL' | 'PROMOTIONAL') || 'TRANSACTIONAL',
        twoWayEnabled: pn.TwoWayEnabled || false,
        registrationStatus: pn.Status,
        isoCountryCode: pn.IsoCountryCode || '',
      };
    } catch (error) {
      throw this.handleSMSError(error);
    }
  }

  /**
   * List opted-out phone numbers
   */
  private async listOptOuts(optOutListName = 'wraps-sms-optouts'): Promise<OptOutEntry[]> {
    try {
      const command = new DescribeOptedOutNumbersCommand({
        OptOutListName: optOutListName,
      });
      const response = await this.smsClient.send(command);

      return (response.OptedOutNumbers || []).map((entry) => ({
        phoneNumber: entry.OptedOutNumber || '',
        optedOutAt: entry.OptedOutTimestamp?.toISOString() || new Date().toISOString(),
      }));
    } catch (error) {
      throw this.handleSMSError(error);
    }
  }

  /**
   * Check if a phone number has opted out
   */
  private async checkOptOut(
    phoneNumber: string,
    optOutListName = 'wraps-sms-optouts'
  ): Promise<boolean> {
    try {
      const command = new DescribeOptedOutNumbersCommand({
        OptOutListName: optOutListName,
        OptedOutNumbers: [phoneNumber],
      });
      const response = await this.smsClient.send(command);

      return (response.OptedOutNumbers?.length || 0) > 0;
    } catch (error) {
      // If the number isn't in the list, AWS may throw an error
      const err = error as { name?: string };
      if (err.name === 'ResourceNotFoundException') {
        return false;
      }
      throw this.handleSMSError(error);
    }
  }

  /**
   * Add a phone number to the opt-out list
   */
  private async addOptOut(
    phoneNumber: string,
    optOutListName = 'wraps-sms-optouts'
  ): Promise<void> {
    try {
      const command = new PutOptedOutNumberCommand({
        OptOutListName: optOutListName,
        OptedOutNumber: phoneNumber,
      });
      await this.smsClient.send(command);
    } catch (error) {
      throw this.handleSMSError(error);
    }
  }

  /**
   * Remove a phone number from the opt-out list
   */
  private async removeOptOut(
    phoneNumber: string,
    optOutListName = 'wraps-sms-optouts'
  ): Promise<void> {
    try {
      const command = new DeleteOptedOutNumberCommand({
        OptOutListName: optOutListName,
        OptedOutNumber: phoneNumber,
      });
      await this.smsClient.send(command);
    } catch (error) {
      throw this.handleSMSError(error);
    }
  }

  /**
   * Handle AWS SDK errors and convert to WrapsSMS errors
   */
  private handleSMSError(error: unknown): Error {
    const err = error as {
      $metadata?: { requestId?: string };
      $retryable?: { throttling?: boolean };
      message?: string;
      name?: string;
    };

    // Check for opt-out error
    if (err.name === 'ConflictException' && err.message?.includes('opted out')) {
      // Extract phone number from error message if possible
      const phoneMatch = err.message.match(/\+\d+/);
      if (phoneMatch) {
        return new OptedOutError(phoneMatch[0]);
      }
    }

    if (err.$metadata) {
      // AWS SDK error
      return new SMSError(
        err.message || 'SMS request failed',
        err.name || 'Unknown',
        err.$metadata.requestId || 'unknown',
        err.$retryable?.throttling || false
      );
    }

    return error as Error;
  }

  /**
   * Close the SMS client and clean up resources
   */
  destroy(): void {
    this.smsClient.destroy();
  }
}
