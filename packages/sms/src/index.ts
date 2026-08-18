export { WrapsSMS } from './client';
export {
  ConfigurationError,
  CREDENTIAL_OPTIONS,
  CredentialsError,
  OptedOutError,
  RateLimitError,
  REGION_OPTIONS,
  type SendingRestriction,
  SendingRestrictionError,
  SMSError,
  ValidationError,
  WrapsSMSError,
} from './errors';
export type {
  BatchMessage,
  BatchMessageResult,
  BatchOptions,
  BatchResult,
  MessageStatus,
  MessageType,
  OptOutEntry,
  PhoneNumber,
  SendOptions,
  SendResult,
  WrapsSMSConfig,
} from './types';

// Utility exports for advanced users
export { calculateSegments, sanitizePhoneNumber, validatePhoneNumber } from './utils/validation';
