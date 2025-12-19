import type {
  PinpointSMSVoiceV2Client,
  PinpointSMSVoiceV2ClientConfig,
} from '@aws-sdk/client-pinpoint-sms-voice-v2';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';

/**
 * Configuration options for the WrapsSMS client
 */
export interface WrapsSMSConfig {
  /**
   * Pre-configured Pinpoint SMS Voice V2 client for advanced authentication scenarios
   * When provided, takes precedence over region, credentials, roleArn, and endpoint
   *
   * @example
   * ```typescript
   * const smsClient = await createCustomSMSClient();
   * const wraps = new WrapsSMS({ client: smsClient });
   * ```
   */
  client?: PinpointSMSVoiceV2Client;

  /**
   * AWS region (defaults to us-east-1)
   * Ignored if `client` is provided
   */
  region?: string;

  /**
   * AWS credentials (optional - falls back to AWS credential chain)
   * Can be static credentials or a credential provider (e.g., from Vercel OIDC)
   * Ignored if `client` is provided
   */
  credentials?:
    | {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      }
    | AwsCredentialIdentityProvider;

  /**
   * IAM Role ARN to assume (for OIDC federation or cross-account access)
   * When provided, the SDK will use STS AssumeRole to obtain temporary credentials
   * Ignored if `client` is provided
   */
  roleArn?: string;

  /**
   * Optional role session name for AssumeRole (defaults to 'wraps-sms-session')
   * Only used when roleArn is provided
   * Ignored if `client` is provided
   */
  roleSessionName?: string;

  /**
   * Custom endpoint (for testing with LocalStack)
   * Ignored if `client` is provided
   */
  endpoint?: string;
}

/**
 * Message type: TRANSACTIONAL for OTP/alerts, PROMOTIONAL for marketing
 */
export type MessageType = 'TRANSACTIONAL' | 'PROMOTIONAL';

/**
 * Message delivery status
 */
export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'PENDING';

/**
 * Options for sending a single SMS message
 */
export interface SendOptions {
  /**
   * Recipient phone number in E.164 format (e.g., +14155551234)
   */
  to: string;

  /**
   * Message body (160 chars = 1 segment for GSM-7, 70 chars for Unicode)
   */
  message: string;

  /**
   * Override sender phone number (if multiple numbers configured)
   * Must be a phone number ID or phone number ARN from your account
   */
  from?: string;

  /**
   * Message type: TRANSACTIONAL (OTP, alerts) or PROMOTIONAL (marketing)
   * Defaults to TRANSACTIONAL
   */
  messageType?: MessageType;

  /**
   * Custom metadata for tracking (stored in DynamoDB if configured)
   */
  context?: Record<string, string>;

  /**
   * Validate without actually sending the message
   */
  dryRun?: boolean;

  /**
   * Maximum price per message segment in USD (e.g., "0.05")
   * Message will fail if it would exceed this price
   */
  maxPrice?: string;

  /**
   * Time-to-live in seconds (message expires if not delivered within this time)
   */
  ttl?: number;

  /**
   * Configuration set name for tracking delivery events
   */
  configurationSetName?: string;
}

/**
 * Result of sending a single SMS message
 */
export interface SendResult {
  /**
   * Unique message identifier
   */
  messageId: string;

  /**
   * Current delivery status
   */
  status: MessageStatus;

  /**
   * Recipient phone number
   */
  to: string;

  /**
   * Sender phone number
   */
  from: string;

  /**
   * Number of SMS segments (each segment is billed separately)
   */
  segments: number;

  /**
   * Cost in USD (if available from response)
   */
  price?: string;

  /**
   * Error details (if status is FAILED)
   */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Single message in a batch send operation
 */
export interface BatchMessage {
  /**
   * Recipient phone number in E.164 format
   */
  to: string;

  /**
   * Message body
   */
  message: string;

  /**
   * Custom metadata for tracking
   */
  context?: Record<string, string>;
}

/**
 * Options for sending batch SMS messages
 */
export interface BatchOptions {
  /**
   * Array of messages to send (max 1,000 for Pro, 10,000 for Growth)
   */
  messages: BatchMessage[];

  /**
   * Override sender phone number for all messages
   */
  from?: string;

  /**
   * Message type for all messages
   */
  messageType?: MessageType;

  /**
   * Configuration set name for tracking
   */
  configurationSetName?: string;
}

/**
 * Result for a single message in a batch operation
 */
export interface BatchMessageResult {
  /**
   * Recipient phone number
   */
  to: string;

  /**
   * Message ID (if queued successfully)
   */
  messageId?: string;

  /**
   * Status of this message
   */
  status: 'QUEUED' | 'FAILED';

  /**
   * Error message (if status is FAILED)
   */
  error?: string;
}

/**
 * Result of a batch send operation
 */
export interface BatchResult {
  /**
   * Unique batch identifier
   */
  batchId: string;

  /**
   * Total number of messages in batch
   */
  total: number;

  /**
   * Number of messages successfully queued
   */
  queued: number;

  /**
   * Number of messages that failed to queue
   */
  failed: number;

  /**
   * Individual results for each message
   */
  results: BatchMessageResult[];
}

/**
 * Options for sending MMS with media
 */
export interface MediaOptions extends SendOptions {
  /**
   * URLs to media files (images, videos, etc.)
   * Must be publicly accessible HTTPS URLs
   */
  mediaUrls: string[];
}

/**
 * Options for scheduling a message
 */
export interface ScheduleOptions extends SendOptions {
  /**
   * When to send the message (ISO 8601 format or Date object)
   */
  sendAt: Date | string;

  /**
   * IANA timezone (e.g., 'America/Los_Angeles')
   * Used to interpret sendAt if it's a local time
   */
  timezone?: string;
}

/**
 * A scheduled message
 */
export interface ScheduledMessage {
  /**
   * Unique message identifier
   */
  messageId: string;

  /**
   * When the message is scheduled to send (ISO 8601)
   */
  scheduledFor: string;

  /**
   * Current status of the scheduled message
   */
  status: 'SCHEDULED' | 'SENT' | 'CANCELLED';

  /**
   * Recipient phone number
   */
  to: string;

  /**
   * Message body
   */
  message: string;
}

/**
 * Phone number information
 */
export interface PhoneNumber {
  /**
   * Phone number ID (AWS resource ID)
   */
  phoneNumberId: string;

  /**
   * Phone number in E.164 format
   */
  phoneNumber: string;

  /**
   * Number type: TOLL_FREE, TEN_DLC, SHORT_CODE, SIMULATOR
   */
  numberType: string;

  /**
   * Message type capability
   */
  messageType: MessageType;

  /**
   * Whether two-way SMS is enabled
   */
  twoWayEnabled: boolean;

  /**
   * Registration status for the number
   */
  registrationStatus?: string;

  /**
   * Monthly cost in USD
   */
  monthlyCost?: string;

  /**
   * ISO country code
   */
  isoCountryCode: string;
}

/**
 * Opt-out list entry
 */
export interface OptOutEntry {
  /**
   * Phone number that has opted out
   */
  phoneNumber: string;

  /**
   * When the opt-out was recorded
   */
  optedOutAt: string;
}

/**
 * Options for listing inbox messages
 */
export interface InboxListOptions {
  /**
   * Only return messages received after this date
   */
  since?: Date;

  /**
   * Maximum number of messages to return
   */
  limit?: number;

  /**
   * Filter by sender phone number
   */
  from?: string;
}

/**
 * An incoming SMS message
 */
export interface IncomingMessage {
  /**
   * Unique message identifier
   */
  messageId: string;

  /**
   * Sender's phone number
   */
  from: string;

  /**
   * Your phone number that received the message
   */
  to: string;

  /**
   * Message body
   */
  message: string;

  /**
   * When the message was received (ISO 8601)
   */
  receivedAt: string;

  /**
   * Whether a reply has been sent
   */
  replied?: boolean;
}

/**
 * Message status details (for getStatus)
 */
export interface MessageStatusDetails {
  /**
   * Message ID
   */
  messageId: string;

  /**
   * Current delivery status
   */
  status: MessageStatus;

  /**
   * Recipient phone number
   */
  to: string;

  /**
   * Sender phone number
   */
  from: string;

  /**
   * Number of segments
   */
  segments: number;

  /**
   * When the message was sent
   */
  sentAt?: string;

  /**
   * When the message was delivered
   */
  deliveredAt?: string;

  /**
   * Error details (if failed)
   */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Internal client config type for createSMSClient
 */
export type SMSClientConfig = PinpointSMSVoiceV2ClientConfig;
