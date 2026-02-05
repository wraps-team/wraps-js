export { defineConfig, defineBrand } from './config';
export type {
  WrapsBrandKit,
  WrapsEnvironment,
  WrapsProjectConfig,
} from './config';
export { WrapsEmail } from './client';
export { SESError, ValidationError, WrapsEmailError } from './errors';
export { WrapsInbox } from './inbox';
export type {
  Attachment,
  BulkTemplateDestination,
  CreateTemplateFromReactParams,
  CreateTemplateParams,
  EmailAddress,
  InboxAttachment,
  InboxEmail,
  InboxEmailAddress,
  InboxEmailSummary,
  InboxForwardOptions,
  InboxGetAttachmentOptions,
  InboxListOptions,
  InboxListResult,
  InboxReplyOptions,
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
