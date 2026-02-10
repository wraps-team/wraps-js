import type { S3Client } from '@aws-sdk/client-s3';
import type { SESClient } from '@aws-sdk/client-ses';
import type { SESv2Client } from '@aws-sdk/client-sesv2';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import type React from 'react';

export interface WrapsEmailConfig {
  /**
   * Pre-configured SES client for advanced authentication scenarios
   * When provided, takes precedence over region, credentials, roleArn, and endpoint
   *
   * @example
   * ```typescript
   * // Multi-account setup with two-step role assumption
   * const sesClient = await createCustomSESClient();
   * const wraps = new WrapsEmail({ client: sesClient });
   * ```
   */
  client?: SESClient;

  /**
   * Pre-configured S3 client for inbox operations
   * When provided, takes precedence over region/credentials for inbox
   */
  s3Client?: S3Client;

  /**
   * S3 bucket name for inbound email storage
   * When provided, enables the inbox API (wraps.inbox.*)
   */
  inboxBucketName?: string;

  /**
   * AWS region for SES (defaults to us-east-1)
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
   * Optional role session name for AssumeRole (defaults to 'wraps-email-session')
   * Only used when roleArn is provided
   * Ignored if `client` is provided
   */
  roleSessionName?: string;

  /**
   * Custom SES endpoint (for testing with LocalStack)
   * Ignored if `client` is provided
   */
  endpoint?: string;

  /**
   * DynamoDB table name for email event history
   * When provided, enables the events API (wraps.events.*)
   */
  historyTableName?: string;

  /**
   * Pre-configured DynamoDB DocumentClient for events
   * When provided, takes precedence over region/credentials for events
   */
  dynamodbClient?: DynamoDBDocumentClient;

  /**
   * Pre-configured SES v2 client for suppression list
   * When provided, takes precedence over region/credentials for suppression
   */
  sesv2Client?: SESv2Client;
}

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface Attachment {
  filename: string;
  content: Buffer | string; // Buffer or base64 string
  contentType?: string;
  encoding?: 'base64' | 'utf-8';
}

export interface SendEmailParams {
  /**
   * Sender email address (must be verified in SES)
   */
  from: string | EmailAddress;

  /**
   * Recipient email address(es)
   */
  to: string | string[] | EmailAddress | EmailAddress[];

  /**
   * CC recipients (optional)
   */
  cc?: string | string[] | EmailAddress | EmailAddress[];

  /**
   * BCC recipients (optional)
   */
  bcc?: string | string[] | EmailAddress | EmailAddress[];

  /**
   * Reply-To address (optional)
   */
  replyTo?: string | string[] | EmailAddress | EmailAddress[];

  /**
   * Email subject
   */
  subject: string;

  /**
   * HTML body (mutually exclusive with 'react')
   */
  html?: string;

  /**
   * Plain text body (optional, auto-generated from html if not provided)
   */
  text?: string;

  /**
   * React.email component (mutually exclusive with 'html')
   */
  react?: React.ReactElement;

  /**
   * Email attachments (optional)
   */
  attachments?: Attachment[];

  /**
   * SES message tags for categorization and tracking (optional)
   */
  tags?: Record<string, string>;

  /**
   * Configuration set name (for tracking opens, clicks, bounces)
   */
  configurationSetName?: string;
}

export interface SendEmailResult {
  messageId: string;
  requestId: string;
}

export interface SendTemplateParams {
  /**
   * Sender email address (must be verified in SES)
   */
  from: string | EmailAddress;

  /**
   * Recipient email address
   */
  to: string | EmailAddress;

  /**
   * CC recipients (optional)
   */
  cc?: string | string[] | EmailAddress | EmailAddress[];

  /**
   * BCC recipients (optional)
   */
  bcc?: string | string[] | EmailAddress | EmailAddress[];

  /**
   * Reply-To address (optional)
   */
  replyTo?: string | string[] | EmailAddress | EmailAddress[];

  /**
   * Template name (must exist in your SES account)
   */
  template: string;

  /**
   * Template data for variable substitution
   */
  templateData: Record<string, unknown>;

  /**
   * SES message tags (optional)
   */
  tags?: Record<string, string>;

  /**
   * Configuration set name (optional)
   */
  configurationSetName?: string;
}

export interface BulkTemplateDestination {
  to: string | EmailAddress;
  templateData: Record<string, unknown>;
  replacementTags?: Record<string, string>;
}

export interface SendBulkTemplateParams {
  /**
   * Sender email address (must be verified in SES)
   */
  from: string | EmailAddress;

  /**
   * Template name (must exist in your SES account)
   */
  template: string;

  /**
   * List of recipients with personalized data (max 50)
   */
  destinations: BulkTemplateDestination[];

  /**
   * Default template data (optional, merged with destination-specific data)
   */
  defaultTemplateData?: Record<string, unknown>;

  /**
   * Reply-To address (optional)
   */
  replyTo?: string | string[] | EmailAddress | EmailAddress[];

  /**
   * Default SES message tags (optional)
   */
  tags?: Record<string, string>;

  /**
   * Configuration set name (optional)
   */
  configurationSetName?: string;
}

export interface SendBulkTemplateResult {
  status: Array<{
    messageId?: string;
    status: 'success' | 'failure';
    error?: string;
  }>;
  requestId: string;
}

export interface CreateTemplateParams {
  /**
   * Template name (unique identifier)
   */
  name: string;

  /**
   * Email subject (supports {{variable}} syntax)
   */
  subject: string;

  /**
   * HTML body (supports {{variable}} syntax)
   */
  html: string;

  /**
   * Plain text body (optional, supports {{variable}} syntax)
   */
  text?: string;
}

export interface CreateTemplateFromReactParams {
  /**
   * Template name (unique identifier)
   */
  name: string;

  /**
   * Email subject (supports {{variable}} syntax)
   */
  subject: string;

  /**
   * React component (should use {{variable}} for SES placeholders)
   */
  react: React.ReactElement;
}

export interface UpdateTemplateParams {
  /**
   * Template name to update
   */
  name: string;

  /**
   * New subject (optional, supports {{variable}} syntax)
   */
  subject?: string;

  /**
   * New HTML body (optional, supports {{variable}} syntax)
   */
  html?: string;

  /**
   * New text body (optional, supports {{variable}} syntax)
   */
  text?: string;
}

export interface TemplateMetadata {
  name: string;
  subject?: string;
  createdTimestamp: Date;
}

export interface Template {
  name: string;
  subject: string;
  htmlPart?: string;
  textPart?: string;
  createdTimestamp: Date;
}

// ============================================================
// Inbox types (inbound email)
// ============================================================

export interface InboxEmailAddress {
  address: string;
  name: string;
}

export interface InboxAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  s3Key: string;
  contentDisposition?: 'attachment' | 'inline';
  cid?: string | null;
}

export interface InboxEmail {
  emailId: string;
  messageId: string;
  from: InboxEmailAddress;
  to: InboxEmailAddress[];
  cc: InboxEmailAddress[];
  subject: string;
  date: string;
  html: string | null;
  htmlTruncated: boolean;
  text: string | null;
  headers: Record<string, string>;
  attachments: InboxAttachment[];
  spamVerdict: string | null;
  virusVerdict: string | null;
  rawS3Key: string;
  receivedAt: string;
}

export interface InboxEmailSummary {
  emailId: string;
  key: string;
  lastModified: Date;
  size: number;
}

export interface InboxListOptions {
  maxResults?: number;
  continuationToken?: string;
}

export interface InboxListResult {
  emails: InboxEmailSummary[];
  nextToken?: string;
}

export interface InboxGetAttachmentOptions {
  expiresIn?: number;
}

export interface InboxForwardOptions {
  /**
   * Recipient(s) to forward to
   */
  to: string | string[] | EmailAddress | EmailAddress[];

  /**
   * Sender address for the forwarded email (must be verified in SES)
   */
  from: string | EmailAddress;

  /**
   * If true (default), forward the raw MIME with rewritten headers.
   * If false, wrap the original content in a new message with a forwarded banner.
   */
  passthrough?: boolean;

  /**
   * Subject prefix (default: "Fwd:" for wrapped mode)
   */
  addPrefix?: string;

  /**
   * Prepended text body (wrapped mode only)
   */
  text?: string;

  /**
   * Prepended HTML body (wrapped mode only)
   */
  html?: string;
}

export interface InboxReplyOptions {
  /**
   * Sender address for the reply (must be verified in SES)
   */
  from: string | EmailAddress;

  /**
   * Plain text reply body
   */
  text?: string;

  /**
   * HTML reply body
   */
  html?: string;

  /**
   * Attachments to include in the reply
   */
  attachments?: Attachment[];
}

// ============================================================
// Email Events types (event history from DynamoDB)
// ============================================================

export interface EmailEvent {
  type: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface EmailStatus {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  /** Derived from the latest event: sent → delivered → opened → clicked, or bounced/complained/suppressed */
  status: 'sent' | 'delivered' | 'bounced' | 'complained' | 'suppressed' | 'opened' | 'clicked';
  sentAt: number;
  lastEventAt: number;
  events: EmailEvent[];
}

export interface EmailListOptions {
  /** Required. The AWS account ID for GSI query. */
  accountId: string;
  /** Only events after this time */
  startTime?: Date;
  /** Only events before this time */
  endTime?: Date;
  /** Max results per page (default 50) */
  maxResults?: number;
  /** Pagination token from previous response */
  continuationToken?: string;
}

export interface EmailListResult {
  emails: EmailStatus[];
  nextToken?: string;
}

// ============================================================
// Suppression List types
// ============================================================

export type SuppressionReason = 'BOUNCE' | 'COMPLAINT';

export interface SuppressionEntry {
  email: string;
  reason: SuppressionReason;
  lastUpdated: Date;
  messageId?: string;
  feedbackId?: string;
}

export interface SuppressionListOptions {
  /** Filter by reason */
  reason?: SuppressionReason;
  /** Only entries added after this date */
  startDate?: Date;
  /** Only entries added before this date */
  endDate?: Date;
  /** Max results per page (default 100, max 1000) */
  maxResults?: number;
  /** Pagination token from previous response */
  continuationToken?: string;
}

export interface SuppressionListResult {
  entries: SuppressionEntry[];
  nextToken?: string;
}
