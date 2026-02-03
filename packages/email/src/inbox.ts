import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { type SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SESError, ValidationError } from './errors';
import type {
  InboxEmail,
  InboxEmailSummary,
  InboxForwardOptions,
  InboxGetAttachmentOptions,
  InboxListOptions,
  InboxListResult,
  InboxReplyOptions,
  SendEmailResult,
} from './types';
import { buildRawEmailMessage } from './utils/mime';
import { normalizeEmailAddress, normalizeEmailAddresses } from './utils/validation';

/**
 * WrapsInbox - Read and manage inbound emails stored in S3
 *
 * Emails are stored by the inbound Lambda processor:
 *   raw/{messageId}           - Raw MIME from SES
 *   parsed/{emailId}.json     - Parsed email JSON
 *   attachments/{emailId}/    - Extracted attachments
 */
export class WrapsInbox {
  private s3Client: S3Client;
  private bucketName: string;
  private sesClient: SESClient | null;

  constructor(s3Client: S3Client, bucketName: string, sesClient?: SESClient) {
    this.s3Client = s3Client;
    this.bucketName = bucketName;
    this.sesClient = sesClient ?? null;
  }

  private requireSES(): SESClient {
    if (!this.sesClient) {
      throw new ValidationError(
        'SES client is required for forward() and reply(). The inbox was initialized without a SES client. ' +
          'Ensure the WrapsEmail client has SES configured.'
      );
    }
    return this.sesClient;
  }

  /**
   * List parsed inbound emails
   */
  async list(options: InboxListOptions = {}): Promise<InboxListResult> {
    const { maxResults = 50, continuationToken } = options;

    try {
      const response = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: 'parsed/',
          MaxKeys: maxResults,
          ContinuationToken: continuationToken,
        })
      );

      const emails: InboxEmailSummary[] = (response.Contents || [])
        .filter((obj) => obj.Key?.endsWith('.json'))
        .map((obj) => {
          // Extract emailId from key: parsed/{emailId}.json
          const key = obj.Key as string; // guaranteed by filter above
          const emailId = key.replace('parsed/', '').replace('.json', '');
          return {
            emailId,
            key,
            lastModified: obj.LastModified || new Date(),
            size: obj.Size || 0,
          };
        });

      return {
        emails,
        nextToken: response.NextContinuationToken,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get a parsed inbound email by ID
   */
  async get(emailId: string): Promise<InboxEmail> {
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: `parsed/${emailId}.json`,
        })
      );

      const body = await response.Body?.transformToString();
      if (!body) throw new Error('Empty response body from S3');
      return JSON.parse(body) as InboxEmail;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get a presigned URL for an attachment
   */
  async getAttachment(
    emailId: string,
    attachmentId: string,
    options: InboxGetAttachmentOptions = {}
  ): Promise<string> {
    const { expiresIn = 3600 } = options; // Default 1 hour

    // List objects in the attachment prefix to find the right one
    try {
      const listResponse = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: `attachments/${emailId}/${attachmentId}-`,
          MaxKeys: 1,
        })
      );

      const key = listResponse.Contents?.[0]?.Key;
      if (!key) {
        throw new Error(`Attachment not found: ${attachmentId} for email ${emailId}`);
      }

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get a presigned URL for the raw MIME email
   */
  async getRaw(emailId: string): Promise<string> {
    try {
      // First get the parsed email to find the rawS3Key
      const email = await this.get(emailId);

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: email.rawS3Key,
      });

      return await getSignedUrl(this.s3Client, command, {
        expiresIn: 3600,
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete an inbound email and all associated files
   */
  async delete(emailId: string): Promise<void> {
    try {
      // Get the parsed email to find the rawS3Key
      let rawS3Key: string | undefined;
      try {
        const email = await this.get(emailId);
        rawS3Key = email.rawS3Key;
      } catch {
        // Email may already be partially deleted
      }

      // List all attachments
      const attachmentKeys: string[] = [];
      const listResponse = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: `attachments/${emailId}/`,
        })
      );
      if (listResponse.Contents) {
        for (const obj of listResponse.Contents) {
          if (obj.Key) attachmentKeys.push(obj.Key);
        }
      }

      // Build list of all objects to delete
      const keysToDelete: string[] = [`parsed/${emailId}.json`, ...attachmentKeys];
      if (rawS3Key) {
        keysToDelete.push(rawS3Key);
      }

      // Delete all objects in a single batch (up to 1000)
      if (keysToDelete.length > 0) {
        await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucketName,
            Delete: {
              Objects: keysToDelete.map((Key) => ({ Key })),
              Quiet: true,
            },
          })
        );
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Forward an inbound email to new recipients
   *
   * Two modes:
   * - passthrough (default): Re-sends raw MIME with rewritten From/To/Subject headers
   * - wrapped: Builds a new message wrapping the original content
   */
  async forward(emailId: string, options: InboxForwardOptions): Promise<SendEmailResult> {
    const ses = this.requireSES();
    const passthrough = options.passthrough !== false;

    if (passthrough) {
      // Passthrough mode: get raw MIME and rewrite headers
      const email = await this.get(emailId);
      const rawResponse = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: email.rawS3Key,
        })
      );
      const rawBody = await rawResponse.Body?.transformToString();
      if (!rawBody) throw new Error('Empty raw email body from S3');
      let rawMime = rawBody;

      // Rewrite From header
      const fromStr = normalizeEmailAddress(options.from);
      rawMime = rawMime.replace(/^From:\s*.+$/im, `From: ${fromStr}`);

      // Rewrite To header
      const toStr = normalizeEmailAddresses(options.to).join(', ');
      rawMime = rawMime.replace(/^To:\s*.+$/im, `To: ${toStr}`);

      // Optionally prefix subject
      if (options.addPrefix) {
        rawMime = rawMime.replace(/^Subject:\s*(.+)$/im, `Subject: ${options.addPrefix} $1`);
      }

      const rawMessageData = new TextEncoder().encode(rawMime);
      const command = new SendRawEmailCommand({
        RawMessage: { Data: rawMessageData },
        Source: fromStr,
        Destinations: normalizeEmailAddresses(options.to),
      });

      try {
        const response = await ses.send(command);
        return {
          messageId: response.MessageId || '',
          requestId: response.$metadata.requestId || '',
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    // Wrapped mode: build new message containing original content
    const email = await this.get(emailId);
    const prefix = options.addPrefix ?? 'Fwd:';
    const subject = `${prefix} ${email.subject}`;

    const forwardBanner = '---------- Forwarded message ----------';
    const fromInfo = `From: ${email.from.name ? `${email.from.name} <${email.from.address}>` : email.from.address}`;
    const dateInfo = `Date: ${email.date}`;
    const subjectInfo = `Subject: ${email.subject}`;
    const toInfo = `To: ${email.to.map((t) => (t.name ? `${t.name} <${t.address}>` : t.address)).join(', ')}`;

    let text: string | undefined;
    if (options.text || email.text) {
      text =
        (options.text ? `${options.text}\n\n` : '') +
        `${forwardBanner}\n${fromInfo}\n${dateInfo}\n${subjectInfo}\n${toInfo}\n\n` +
        (email.text || '');
    }

    let html: string | undefined;
    if (options.html || email.html) {
      const headerHtml = `<br><br><div style="border-top:1px solid #ccc;padding-top:10px"><b>${forwardBanner}</b><br>${fromInfo}<br>${dateInfo}<br>${subjectInfo}<br>${toInfo}<br><br>`;
      html =
        (options.html || '') +
        headerHtml +
        (email.html || `<pre>${email.text || ''}</pre>`) +
        '</div>';
    }

    const rawMessage = buildRawEmailMessage({
      from: options.from,
      to: options.to,
      subject,
      text,
      html,
    });

    const rawMessageData = new TextEncoder().encode(rawMessage);
    const command = new SendRawEmailCommand({
      RawMessage: { Data: rawMessageData },
    });

    try {
      const response = await ses.send(command);
      return {
        messageId: response.MessageId || '',
        requestId: response.$metadata.requestId || '',
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Reply to an inbound email with proper threading headers (In-Reply-To, References)
   */
  async reply(emailId: string, options: InboxReplyOptions): Promise<SendEmailResult> {
    const ses = this.requireSES();
    const email = await this.get(emailId);

    // Build threading headers
    const customHeaders: Record<string, string> = {};
    if (email.messageId) {
      customHeaders['In-Reply-To'] = email.messageId;
      const existingRefs = email.headers?.references || email.headers?.References || '';
      customHeaders.References = existingRefs
        ? `${existingRefs} ${email.messageId}`
        : email.messageId;
    }

    // Subject: prepend Re: if not already present
    const subject = /^Re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`;

    // Reply to the original sender
    const replyTo = email.from.name
      ? `${email.from.name} <${email.from.address}>`
      : email.from.address;

    const rawMessage = buildRawEmailMessage({
      from: options.from,
      to: replyTo,
      subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
      customHeaders,
    });

    const rawMessageData = new TextEncoder().encode(rawMessage);
    const command = new SendRawEmailCommand({
      RawMessage: { Data: rawMessageData },
    });

    try {
      const response = await ses.send(command);
      return {
        messageId: response.MessageId || '',
        requestId: response.$metadata.requestId || '',
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private handleError(error: unknown): Error {
    const err = error as {
      $metadata?: { requestId?: string };
      message?: string;
      name?: string;
    };
    if (err.$metadata) {
      return new SESError(
        err.message || 'S3 request failed',
        err.name || 'Unknown',
        err.$metadata.requestId || 'unknown',
        false
      );
    }
    return error as Error;
  }
}
