import {
  CreateTemplateCommand,
  DeleteTemplateCommand,
  GetTemplateCommand,
  ListTemplatesCommand,
  type SESClient,
  SendBulkTemplatedEmailCommand,
  SendEmailCommand,
  SendRawEmailCommand,
  SendTemplatedEmailCommand,
  UpdateTemplateCommand,
} from '@aws-sdk/client-ses';
import type { SESv2Client } from '@aws-sdk/client-sesv2';
import { sendBatch as sendBatchImpl } from './batch';
import { SESError, ValidationError } from './errors';
import { WrapsEmailEvents } from './events';
import { WrapsInbox } from './inbox';
import { renderReactEmail } from './react';
import { WrapsEmailSuppression } from './suppression';
import type {
  CreateTemplateFromReactParams,
  CreateTemplateParams,
  EmailAddress,
  SendBatchParams,
  SendBatchResult,
  SendBulkTemplateParams,
  SendBulkTemplateResult,
  SendEmailParams,
  SendEmailResult,
  SendTemplateParams,
  Template,
  TemplateMetadata,
  UpdateTemplateParams,
  WrapsEmailConfig,
} from './types';
import { createSESClient } from './utils/credentials';
import { buildRawEmailMessage } from './utils/mime';
import {
  normalizeEmailAddress,
  normalizeEmailAddresses,
  validateEmailParams,
} from './utils/validation';

export class WrapsEmail {
  private sesClient: SESClient;
  private sesv2Client: SESv2Client;

  /**
   * Inbox for reading inbound emails
   * Only available when inboxBucketName is configured
   */
  public readonly inbox: WrapsInbox | null;

  /**
   * Email event history from DynamoDB
   * Only available when historyTableName is configured
   */
  public readonly events: WrapsEmailEvents | null;

  /**
   * Suppression list management (SES v2)
   * Always available when credentials are configured
   */
  public readonly suppression: WrapsEmailSuppression;

  /**
   * Template management methods
   */
  public readonly templates: {
    create: (params: CreateTemplateParams) => Promise<void>;
    createFromReact: (params: CreateTemplateFromReactParams) => Promise<void>;
    update: (params: UpdateTemplateParams) => Promise<void>;
    get: (name: string) => Promise<Template>;
    list: () => Promise<TemplateMetadata[]>;
    delete: (name: string) => Promise<void>;
  };

  constructor(config: WrapsEmailConfig = {}) {
    this.sesClient = createSESClient(config);

    // Initialize inbox if bucket name provided
    if (config.inboxBucketName) {
      if (config.s3Client) {
        this.inbox = new WrapsInbox(config.s3Client, config.inboxBucketName, this.sesClient);
      } else {
        // Dynamically import S3Client to avoid adding it as a required dependency
        // for users who don't use inbox
        const { S3Client } = require('@aws-sdk/client-s3');
        const s3Config: Record<string, unknown> = {
          region: config.region || 'us-east-1',
        };
        if (config.credentials) {
          s3Config.credentials = config.credentials;
        }
        if (config.endpoint) {
          s3Config.endpoint = config.endpoint;
        }
        this.inbox = new WrapsInbox(new S3Client(s3Config), config.inboxBucketName, this.sesClient);
      }
    } else {
      this.inbox = null;
    }

    // Initialize events API (requires historyTableName)
    if (config.historyTableName) {
      if (config.dynamodbClient) {
        this.events = new WrapsEmailEvents(config.dynamodbClient, config.historyTableName);
      } else {
        const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
        const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
        const dynamoConfig: Record<string, unknown> = {
          region: config.region || 'us-east-1',
        };
        if (config.credentials) {
          dynamoConfig.credentials = config.credentials;
        }
        if (config.endpoint) {
          dynamoConfig.endpoint = config.endpoint;
        }
        const docClient = DynamoDBDocumentClient.from(new DynamoDBClient(dynamoConfig), {
          marshallOptions: { removeUndefinedValues: true },
        });
        this.events = new WrapsEmailEvents(docClient, config.historyTableName);
      }
    } else {
      this.events = null;
    }

    // Initialize SES v2 client (used by suppression and batch)
    if (config.sesv2Client) {
      this.sesv2Client = config.sesv2Client;
    } else {
      const { SESv2Client: SESv2ClientClass } = require('@aws-sdk/client-sesv2');
      const sesv2Config: Record<string, unknown> = {
        region: config.region || 'us-east-1',
      };
      if (config.credentials) {
        sesv2Config.credentials = config.credentials;
      }
      if (config.endpoint) {
        sesv2Config.endpoint = config.endpoint;
      }
      this.sesv2Client = new SESv2ClientClass(sesv2Config);
    }
    this.suppression = new WrapsEmailSuppression(this.sesv2Client);

    // Initialize templates namespace
    this.templates = {
      create: this.createTemplate.bind(this),
      createFromReact: this.createTemplateFromReact.bind(this),
      update: this.updateTemplate.bind(this),
      get: this.getTemplate.bind(this),
      list: this.listTemplates.bind(this),
      delete: this.deleteTemplate.bind(this),
    };
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    // Validate parameters
    validateEmailParams(params);

    // Handle React.email rendering
    let html = params.html;
    let text = params.text;

    if (params.react) {
      if (params.html) {
        throw new ValidationError('Cannot provide both "html" and "react" parameters');
      }
      const rendered = await renderReactEmail(params.react);
      html = rendered.html;
      text = text || rendered.text; // Use provided text or fallback to rendered
    }

    // Handle attachments (requires SES v2 SendRawEmail)
    if (params.attachments && params.attachments.length > 0) {
      return this.sendWithAttachments(params);
    }

    // Build SES SendEmail command
    const command = new SendEmailCommand({
      Source: normalizeEmailAddress(params.from),
      Destination: {
        ToAddresses: normalizeEmailAddresses(params.to),
        CcAddresses: params.cc ? normalizeEmailAddresses(params.cc) : undefined,
        BccAddresses: params.bcc ? normalizeEmailAddresses(params.bcc) : undefined,
      },
      ReplyToAddresses: params.replyTo ? normalizeEmailAddresses(params.replyTo) : undefined,
      Message: {
        Subject: {
          Data: params.subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: html
            ? {
                Data: html,
                Charset: 'UTF-8',
              }
            : undefined,
          Text: text
            ? {
                Data: text,
                Charset: 'UTF-8',
              }
            : undefined,
        },
      },
      Tags: params.tags
        ? Object.entries(params.tags).map(([Name, Value]) => ({
            Name,
            Value,
          }))
        : undefined,
      ConfigurationSetName: params.configurationSetName,
    });

    // Send email
    try {
      const response = await this.sesClient.send(command);

      if (!response.MessageId || !response.$metadata.requestId) {
        throw new Error('Invalid response from SES: missing MessageId or requestId');
      }

      return {
        messageId: response.MessageId,
        requestId: response.$metadata.requestId,
      };
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  private async sendWithAttachments(params: SendEmailParams): Promise<SendEmailResult> {
    // Validate that we have attachments
    if (!params.attachments || params.attachments.length === 0) {
      throw new ValidationError('sendWithAttachments called without attachments');
    }

    // Validate attachment count (AWS limit: 10MB total message size, max 500 MIME parts)
    if (params.attachments.length > 100) {
      throw new ValidationError('Maximum 100 attachments allowed per email');
    }

    // Handle React rendering if needed
    let html = params.html;
    let text = params.text;

    if (params.react) {
      if (params.html) {
        throw new ValidationError('Cannot provide both "html" and "react" parameters');
      }
      const rendered = await renderReactEmail(params.react);
      html = rendered.html;
      text = text || rendered.text;
    }

    // Build raw MIME message
    const rawMessage = buildRawEmailMessage({
      from: params.from,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      replyTo: params.replyTo,
      subject: params.subject,
      html,
      text,
      attachments: params.attachments,
    });

    // Convert to Uint8Array for SES
    const rawMessageData = new TextEncoder().encode(rawMessage);

    // Build SendRawEmail command
    const command = new SendRawEmailCommand({
      RawMessage: {
        Data: rawMessageData,
      },
      Tags: params.tags
        ? Object.entries(params.tags).map(([Name, Value]) => ({
            Name,
            Value,
          }))
        : undefined,
      ConfigurationSetName: params.configurationSetName,
    });

    // Send email
    try {
      const response = await this.sesClient.send(command);

      if (!response.MessageId || !response.$metadata.requestId) {
        throw new Error('Invalid response from SES: missing MessageId or requestId');
      }

      return {
        messageId: response.MessageId,
        requestId: response.$metadata.requestId,
      };
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  private handleSESError(error: unknown): Error {
    const err = error as {
      $metadata?: { requestId?: string };
      $retryable?: { throttling?: boolean };
      message?: string;
      name?: string;
    };
    if (err.$metadata) {
      // AWS SDK error
      return new SESError(
        err.message || 'SES request failed',
        err.name || 'Unknown',
        err.$metadata.requestId || 'unknown',
        err.$retryable?.throttling || false
      );
    }
    return error as Error;
  }

  /**
   * Send email using an SES template
   */
  async sendTemplate(params: SendTemplateParams): Promise<SendEmailResult> {
    const toAddresses: (string | EmailAddress)[] = Array.isArray(params.to)
      ? params.to
      : [params.to];
    const command = new SendTemplatedEmailCommand({
      Source: normalizeEmailAddress(params.from),
      Destination: {
        ToAddresses: normalizeEmailAddresses(toAddresses),
        CcAddresses: params.cc ? normalizeEmailAddresses(params.cc) : undefined,
        BccAddresses: params.bcc ? normalizeEmailAddresses(params.bcc) : undefined,
      },
      ReplyToAddresses: params.replyTo ? normalizeEmailAddresses(params.replyTo) : undefined,
      Template: params.template,
      TemplateData: JSON.stringify(params.templateData),
      Tags: params.tags
        ? Object.entries(params.tags).map(([Name, Value]) => ({
            Name,
            Value,
          }))
        : undefined,
      ConfigurationSetName: params.configurationSetName,
    });

    try {
      const response = await this.sesClient.send(command);

      if (!response.MessageId || !response.$metadata.requestId) {
        throw new Error('Invalid response from SES: missing MessageId or requestId');
      }

      return {
        messageId: response.MessageId,
        requestId: response.$metadata.requestId,
      };
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  /**
   * Send bulk emails using an SES template (up to 50 recipients)
   */
  async sendBulkTemplate(params: SendBulkTemplateParams): Promise<SendBulkTemplateResult> {
    if (params.destinations.length > 50) {
      throw new ValidationError('Maximum 50 destinations allowed per bulk send');
    }

    const command = new SendBulkTemplatedEmailCommand({
      Source: normalizeEmailAddress(params.from),
      ReplyToAddresses: params.replyTo ? normalizeEmailAddresses(params.replyTo) : undefined,
      Template: params.template,
      DefaultTemplateData: params.defaultTemplateData
        ? JSON.stringify(params.defaultTemplateData)
        : undefined,
      Destinations: params.destinations.map((dest) => {
        const destToAddresses: (string | EmailAddress)[] = Array.isArray(dest.to)
          ? dest.to
          : [dest.to];
        return {
          Destination: {
            ToAddresses: normalizeEmailAddresses(destToAddresses),
          },
          ReplacementTemplateData: JSON.stringify(dest.templateData),
          ReplacementTags: dest.replacementTags
            ? Object.entries(dest.replacementTags).map(([Name, Value]) => ({
                Name,
                Value,
              }))
            : undefined,
        };
      }),
      DefaultTags: params.tags
        ? Object.entries(params.tags).map(([Name, Value]) => ({
            Name,
            Value,
          }))
        : undefined,
      ConfigurationSetName: params.configurationSetName,
    });

    try {
      const response = await this.sesClient.send(command);

      if (!response.Status || !response.$metadata.requestId) {
        throw new Error('Invalid response from SES: missing Status or requestId');
      }

      return {
        status: response.Status.map((s) => ({
          messageId: s.MessageId,
          status: s.Status as 'success' | 'failure',
          error: s.Error,
        })),
        requestId: response.$metadata.requestId,
      };
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  /**
   * Send batch emails with unique content per recipient (max 100 entries).
   *
   * Unlike `sendBulkTemplate()` which requires a pre-created SES template,
   * `sendBatch()` lets you provide different subject/html/text per recipient
   * inline without creating a template first.
   *
   * Uses SES v2 `SendBulkEmailCommand` with inline template content.
   *
   * **Note:** Literal `{{` and `}}` in HTML content will be interpreted as
   * SES template placeholders.
   *
   * @example
   * ```typescript
   * const result = await wraps.sendBatch({
   *   from: 'hello@example.com',
   *   entries: [
   *     { to: 'alice@example.com', subject: 'Hi Alice', html: '<p>Hello Alice!</p>' },
   *     { to: 'bob@example.com', subject: 'Hi Bob', html: '<p>Hello Bob!</p>' },
   *   ],
   * });
   * console.log(result.successCount); // 2
   * ```
   */
  async sendBatch(params: SendBatchParams): Promise<SendBatchResult> {
    return sendBatchImpl(this.sesv2Client, params);
  }

  /**
   * Create a new SES template
   */
  private async createTemplate(params: CreateTemplateParams): Promise<void> {
    const command = new CreateTemplateCommand({
      Template: {
        TemplateName: params.name,
        SubjectPart: params.subject,
        HtmlPart: params.html,
        TextPart: params.text,
      },
    });

    try {
      await this.sesClient.send(command);
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  /**
   * Create template from React.email component
   */
  private async createTemplateFromReact(params: CreateTemplateFromReactParams): Promise<void> {
    const { html, text } = await renderReactEmail(params.react);

    await this.createTemplate({
      name: params.name,
      subject: params.subject,
      html,
      text,
    });
  }

  /**
   * Update an existing SES template
   */
  private async updateTemplate(params: UpdateTemplateParams): Promise<void> {
    const command = new UpdateTemplateCommand({
      Template: {
        TemplateName: params.name,
        SubjectPart: params.subject,
        HtmlPart: params.html,
        TextPart: params.text,
      },
    });

    try {
      await this.sesClient.send(command);
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  /**
   * Get template details
   */
  private async getTemplate(name: string): Promise<Template> {
    const command = new GetTemplateCommand({
      TemplateName: name,
    });

    try {
      const response = await this.sesClient.send(command);

      if (!response.Template?.TemplateName || !response.Template.SubjectPart) {
        throw new Error('Invalid template response from SES: missing template data');
      }

      return {
        name: response.Template.TemplateName,
        subject: response.Template.SubjectPart,
        htmlPart: response.Template.HtmlPart,
        textPart: response.Template.TextPart,
        createdTimestamp: new Date(), // SES doesn't return timestamp in GetTemplate
      };
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  /**
   * List all templates
   */
  private async listTemplates(): Promise<TemplateMetadata[]> {
    const command = new ListTemplatesCommand({
      MaxItems: 100, // Can be paginated if needed
    });

    try {
      const response = await this.sesClient.send(command);

      return (response.TemplatesMetadata || [])
        .filter((t) => t.Name && t.CreatedTimestamp)
        .map((t) => ({
          name: t.Name as string,
          createdTimestamp: t.CreatedTimestamp as Date,
        }));
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  /**
   * Delete a template
   */
  private async deleteTemplate(name: string): Promise<void> {
    const command = new DeleteTemplateCommand({
      TemplateName: name,
    });

    try {
      await this.sesClient.send(command);
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  /**
   * Close the SES client and clean up resources
   */
  destroy(): void {
    this.sesClient.destroy();
    this.sesv2Client.destroy();
  }
}
