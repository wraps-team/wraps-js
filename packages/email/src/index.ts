export { WrapsEmail } from './client';
export { DynamoDBError, SESError, ValidationError, WrapsEmailError } from './errors';
export { WrapsEmailEvents } from './events';
export { WrapsInbox } from './inbox';
export { WrapsEmailSuppression } from './suppression';
export type {
  Attachment,
  BulkTemplateDestination,
  CreateTemplateFromReactParams,
  CreateTemplateParams,
  EmailAddress,
  EmailEvent,
  EmailListOptions,
  EmailListResult,
  EmailStatus,
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
  SuppressionEntry,
  SuppressionListOptions,
  SuppressionListResult,
  SuppressionReason,
  Template,
  TemplateMetadata,
  UpdateTemplateParams,
  WrapsEmailConfig,
} from './types';
