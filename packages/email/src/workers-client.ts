import { AwsClient } from 'aws4fetch';
import { SESError, ValidationError } from './errors';
import type { EmailAddress, SendEmailParams, SendEmailResult } from './types';
import { htmlToPlainText } from './utils/html-to-text';
import {
  normalizeEmailAddress,
  normalizeEmailAddresses,
  validateEmailParams,
} from './utils/validation';

/**
 * Static AWS credentials for edge environments.
 * Workers have no AWS credential chain, so region and credentials are required.
 */
export interface WrapsEmailWorkerConfig {
  /** AWS region where your SES is configured (e.g. `'us-east-1'`). */
  region: string;
  /** Static AWS credentials. Store these as Wrangler secrets — never in source. */
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /**
   * Custom SESv2 REST endpoint override. Defaults to the standard regional endpoint.
   * Useful for local testing or custom domains.
   */
  endpoint?: string;
}

/**
 * Subset of {@link SendEmailParams} supported at the edge.
 *
 * Not supported on the edge entry: `react` (render to HTML first),
 * `attachments` (MIME serialization requires Node built-ins),
 * `conversationId`, `sendId`, `replyTtlSeconds` (reply-threading uses SSM).
 */
export type WorkerSendEmailParams = Omit<
  SendEmailParams,
  'react' | 'attachments' | 'conversationId' | 'sendId' | 'replyTtlSeconds'
>;

/**
 * Edge-native SES email client for Cloudflare Workers and other `workerd`-based runtimes.
 *
 * Uses `aws4fetch` (Web Crypto) to sign requests and the SESv2 REST API (JSON payloads,
 * no `DOMParser`) — zero Node.js APIs, ~5 KiB bundled.
 *
 * @example
 * ```typescript
 * const email = new WrapsEmail({
 *   region: env.AWS_REGION,
 *   credentials: {
 *     accessKeyId: env.AWS_ACCESS_KEY_ID,
 *     secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
 *   },
 * });
 * const result = await email.send({
 *   from: 'hello@example.com',
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   html: '<h1>Hello</h1>',
 * });
 * ```
 */
export class WrapsEmail {
  private readonly aws: AwsClient;
  private readonly endpoint: string;

  /**
   * Create a new edge-native SES client.
   *
   * @param config - Region and static AWS credentials (required at the edge).
   * @throws {ValidationError} If `region` or credentials fields are missing.
   */
  constructor(config: WrapsEmailWorkerConfig) {
    if (!config?.region) {
      throw new ValidationError('Missing required field: region', 'region');
    }
    if (!config?.credentials?.accessKeyId || !config?.credentials?.secretAccessKey) {
      throw new ValidationError('Missing required field: credentials', 'credentials');
    }
    this.aws = new AwsClient({
      accessKeyId: config.credentials.accessKeyId,
      secretAccessKey: config.credentials.secretAccessKey,
      sessionToken: config.credentials.sessionToken,
      service: 'ses',
      region: config.region,
      retries: 0, // we handle errors ourselves; do not let aws4fetch retry
    });
    this.endpoint =
      config.endpoint ?? `https://email.${config.region}.amazonaws.com/v2/email/outbound-emails`;
  }

  /**
   * Send a single email via the SESv2 REST API.
   *
   * Mirrors the Node `WrapsEmail.send()` surface — change only the import path.
   * When `html` is provided without `text`, plain text is auto-generated.
   *
   * @param params - Email send options. `react` and `attachments` are not supported at the edge.
   * @returns Resolved with `{ messageId, requestId }` on success.
   * @throws {ValidationError} If required fields are missing or unsupported options are used.
   * @throws {SESError} If the SESv2 API returns a non-2xx response.
   *
   * @example
   * ```typescript
   * const result = await email.send({
   *   from: 'hello@example.com',
   *   to: ['alice@example.com', 'bob@example.com'],
   *   subject: 'Hello!',
   *   html: '<p>Hi there</p>',
   * });
   * console.log(result.messageId);
   * ```
   */
  async send(params: WorkerSendEmailParams): Promise<SendEmailResult> {
    const p = params as SendEmailParams;

    if (p.react) {
      throw new ValidationError(
        'react is not supported at the edge; render to html first',
        'react'
      );
    }
    if (p.attachments && p.attachments.length > 0) {
      throw new ValidationError('attachments are not supported at the edge', 'attachments');
    }

    validateEmailParams(p);

    const payload = this.buildSesV2Payload(params);
    const res = await this.aws.fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw await this.mapSesV2Error(res);
    }

    const requestId = res.headers.get('x-amzn-requestid') ?? 'unknown';
    const body = (await res.json()) as { MessageId?: string };

    if (!body.MessageId) {
      throw new SESError(
        'Invalid response from SES: missing MessageId',
        'Unknown',
        requestId,
        false
      );
    }

    return { messageId: body.MessageId, requestId };
  }

  private buildSesV2Payload(params: WorkerSendEmailParams): Record<string, unknown> {
    let { html, text } = params;
    if (html && !text) text = htmlToPlainText(html);

    const body: Record<string, unknown> = {};
    if (html) body.Html = { Data: html, Charset: 'UTF-8' };
    if (text) body.Text = { Data: text, Charset: 'UTF-8' };

    const payload: Record<string, unknown> = {
      FromEmailAddress: normalizeEmailAddress(params.from),
      Destination: {
        ToAddresses: normalizeEmailAddresses(params.to),
        ...(params.cc ? { CcAddresses: normalizeEmailAddresses(params.cc) } : {}),
        ...(params.bcc ? { BccAddresses: normalizeEmailAddresses(params.bcc) } : {}),
      },
      ...(params.replyTo ? { ReplyToAddresses: normalizeEmailAddresses(params.replyTo) } : {}),
      Content: {
        Simple: {
          Subject: { Data: params.subject, Charset: 'UTF-8' },
          Body: body,
        },
      },
      ...(params.tags
        ? { EmailTags: Object.entries(params.tags).map(([Name, Value]) => ({ Name, Value })) }
        : {}),
      ...(params.configurationSetName ? { ConfigurationSetName: params.configurationSetName } : {}),
    };

    return payload;
  }

  private async mapSesV2Error(res: Response): Promise<SESError> {
    const requestId = res.headers.get('x-amzn-requestid') ?? 'unknown';
    const code = (res.headers.get('x-amzn-errortype') ?? 'Unknown').split(':')[0] || 'Unknown';

    let message = 'SES request failed';
    try {
      const errBody = (await res.json()) as { message?: string; Message?: string };
      message = errBody.message ?? errBody.Message ?? message;
    } catch {
      message = (await res.text().catch(() => '')) || message;
    }

    const retryable = res.status === 429 || res.status >= 500;
    return new SESError(message, code, requestId, retryable);
  }
}

// Re-export EmailAddress so callers can use it without a separate import
export type { EmailAddress };
