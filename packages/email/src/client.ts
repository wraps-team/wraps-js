import {
  SESClient,
  SendEmailCommand,
  SendTemplatedEmailCommand,
  SendBulkTemplatedEmailCommand,
  CreateTemplateCommand,
  UpdateTemplateCommand,
  GetTemplateCommand,
  ListTemplatesCommand,
  DeleteTemplateCommand,
} from '@aws-sdk/client-ses';
import { createSESClient } from './utils/credentials';
import { renderReactEmail } from './react';
import {
  validateEmailParams,
  normalizeEmailAddress,
  normalizeEmailAddresses,
} from './utils/validation';
import { WrapsEmailError, ValidationError, SESError } from './errors';
import type {
  WrapsEmailConfig,
  SendEmailParams,
  SendEmailResult,
  SendTemplateParams,
  SendBulkTemplateParams,
  SendBulkTemplateResult,
  CreateTemplateParams,
  CreateTemplateFromReactParams,
  UpdateTemplateParams,
  Template,
  TemplateMetadata,
  EmailAddress,
} from './types';

export class WrapsEmail {
  private sesClient: SESClient;

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
        throw new ValidationError(
          'Cannot provide both "html" and "react" parameters'
        );
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
        CcAddresses: params.cc
          ? normalizeEmailAddresses(params.cc)
          : undefined,
        BccAddresses: params.bcc
          ? normalizeEmailAddresses(params.bcc)
          : undefined,
      },
      ReplyToAddresses: params.replyTo
        ? normalizeEmailAddresses(params.replyTo)
        : undefined,
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

      return {
        messageId: response.MessageId!,
        requestId: response.$metadata.requestId!,
      };
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  private async sendWithAttachments(
    params: SendEmailParams
  ): Promise<SendEmailResult> {
    // Implementation using nodemailer + SES transport for attachments
    // (SES SendEmail doesn't support attachments, need SendRawEmail)
    throw new Error('Attachments support coming soon');
  }

  private handleSESError(error: any): Error {
    if (error.$metadata) {
      // AWS SDK error
      return new SESError(
        error.message || 'SES request failed',
        error.name || 'Unknown',
        error.$metadata.requestId || 'unknown',
        error.$retryable?.throttling || false
      );
    }
    return error;
  }

  /**
   * Send email using an SES template
   */
  async sendTemplate(params: SendTemplateParams): Promise<SendEmailResult> {
    const toAddresses: (string | EmailAddress)[] = Array.isArray(params.to) ? params.to : [params.to];
    const command = new SendTemplatedEmailCommand({
      Source: normalizeEmailAddress(params.from),
      Destination: {
        ToAddresses: normalizeEmailAddresses(toAddresses),
        CcAddresses: params.cc
          ? normalizeEmailAddresses(params.cc)
          : undefined,
        BccAddresses: params.bcc
          ? normalizeEmailAddresses(params.bcc)
          : undefined,
      },
      ReplyToAddresses: params.replyTo
        ? normalizeEmailAddresses(params.replyTo)
        : undefined,
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
      return {
        messageId: response.MessageId!,
        requestId: response.$metadata.requestId!,
      };
    } catch (error) {
      throw this.handleSESError(error);
    }
  }

  /**
   * Send bulk emails using an SES template (up to 50 recipients)
   */
  async sendBulkTemplate(
    params: SendBulkTemplateParams
  ): Promise<SendBulkTemplateResult> {
    if (params.destinations.length > 50) {
      throw new ValidationError(
        'Maximum 50 destinations allowed per bulk send'
      );
    }

    const command = new SendBulkTemplatedEmailCommand({
      Source: normalizeEmailAddress(params.from),
      ReplyToAddresses: params.replyTo
        ? normalizeEmailAddresses(params.replyTo)
        : undefined,
      Template: params.template,
      DefaultTemplateData: params.defaultTemplateData
        ? JSON.stringify(params.defaultTemplateData)
        : undefined,
      Destinations: params.destinations.map((dest) => {
        const destToAddresses: (string | EmailAddress)[] = Array.isArray(dest.to) ? dest.to : [dest.to];
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

      return {
        status: response.Status!.map((s) => ({
          messageId: s.MessageId,
          status: s.Status as 'success' | 'failure',
          error: s.Error,
        })),
        requestId: response.$metadata.requestId!,
      };
    } catch (error) {
      throw this.handleSESError(error);
    }
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
  private async createTemplateFromReact(
    params: CreateTemplateFromReactParams
  ): Promise<void> {
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
      const template = response.Template!;

      return {
        name: template.TemplateName!,
        subject: template.SubjectPart!,
        htmlPart: template.HtmlPart,
        textPart: template.TextPart,
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

      return (response.TemplatesMetadata || []).map((t) => ({
        name: t.Name!,
        createdTimestamp: t.CreatedTimestamp!,
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
  }
}
