/**
 * Base error class for all Wraps SMS errors
 */
export class WrapsSMSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrapsSMSError';
  }
}

/**
 * Error thrown when validation fails (e.g., invalid phone number format)
 */
export class ValidationError extends WrapsSMSError {
  /**
   * The field that failed validation
   */
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Error thrown when an AWS SMS API operation fails
 */
export class SMSError extends WrapsSMSError {
  /**
   * AWS error code (e.g., 'ThrottlingException', 'ValidationException')
   */
  public readonly code: string;

  /**
   * AWS request ID for debugging
   */
  public readonly requestId: string;

  /**
   * Whether the operation can be retried
   */
  public readonly retryable: boolean;

  constructor(message: string, code: string, requestId: string, retryable: boolean) {
    super(message);
    this.name = 'SMSError';
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

/**
 * Error thrown when a phone number is opted out
 */
export class OptedOutError extends WrapsSMSError {
  /**
   * The phone number that has opted out
   */
  public readonly phoneNumber: string;

  constructor(phoneNumber: string) {
    super(`Phone number ${phoneNumber} has opted out of receiving messages`);
    this.name = 'OptedOutError';
    this.phoneNumber = phoneNumber;
  }
}

/**
 * Error thrown when rate limits are exceeded
 */
export class RateLimitError extends WrapsSMSError {
  /**
   * Number of seconds to wait before retrying
   */
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}
