import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import type React from 'react';

export interface WrapsEmailConfig {
  /**
   * AWS region for SES (defaults to us-east-1)
   */
  region?: string;

  /**
   * AWS credentials (optional - falls back to AWS credential chain)
   * Can be static credentials or a credential provider (e.g., from Vercel OIDC)
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
   */
  roleArn?: string;

  /**
   * Optional role session name for AssumeRole (defaults to 'wraps-email-session')
   * Only used when roleArn is provided
   */
  roleSessionName?: string;

  /**
   * Custom SES endpoint (for testing with LocalStack)
   */
  endpoint?: string;
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
