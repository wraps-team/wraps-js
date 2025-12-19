export { WrapsSMS } from './client';
export {
  OptedOutError,
  RateLimitError,
  SMSError,
  ValidationError,
  WrapsSMSError,
} from './errors';
export type {
  BatchMessage,
  BatchMessageResult,
  BatchOptions,
  BatchResult,
  InboxListOptions,
  IncomingMessage,
  MediaOptions,
  MessageStatus,
  MessageStatusDetails,
  MessageType,
  OptOutEntry,
  PhoneNumber,
  ScheduledMessage,
  ScheduleOptions,
  SendOptions,
  SendResult,
  WrapsSMSConfig,
} from './types';

// Utility exports for advanced users
export { calculateSegments, sanitizePhoneNumber, validatePhoneNumber } from './utils/validation';
