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

/**
 * Shared by the credential-not-found error. Deliberately neutral: it lists
 * every way credentials can be provided without prescribing or ranking one.
 * Copy is kept in sync with `CREDENTIAL_OPTIONS` in the Wraps CLI
 * (`packages/cli/src/utils/shared/errors.ts`).
 */
export const CREDENTIAL_OPTIONS = `Wraps couldn't find working AWS credentials. Any of these work:

AWS SSO:
  aws configure sso
  aws sso login

IAM access keys:
  aws configure

Environment variables:
  export AWS_ACCESS_KEY_ID=<your-key>
  export AWS_SECRET_ACCESS_KEY=<your-secret>

Existing profile:
  export AWS_PROFILE=<profile-name>`;

/**
 * Same neutral posture as CREDENTIAL_OPTIONS, for region. Mirrors
 * `REGION_NOT_FOUND` in `@wraps.dev/mcp` (`src/config.ts`).
 */
export const REGION_OPTIONS = `Wraps couldn't resolve an AWS region. Any of these work:

SDK config:
  new WrapsSMS({ region: 'us-east-1' })

Environment variables:
  export AWS_REGION=us-east-1
  export AWS_DEFAULT_REGION=us-east-1

AWS profile (~/.aws/config):
  aws configure set region us-east-1
  export AWS_PROFILE=<profile-name>`;

/**
 * Error thrown when AWS credentials could not be resolved.
 *
 * The AWS SDK's own `CredentialsProviderError` does not extend
 * {@link WrapsSMSError}, so without this wrapper the most common first-run
 * failure escapes the SDK's error hierarchy entirely.
 */
export class CredentialsError extends WrapsSMSError {
  /**
   * The underlying AWS SDK error, for callers that need the raw detail
   */
  public readonly cause?: unknown;

  constructor(message: string = CREDENTIAL_OPTIONS, cause?: unknown) {
    super(message);
    this.name = 'CredentialsError';
    this.cause = cause;
  }
}

/**
 * Error thrown when the SDK is misconfigured — currently only when no AWS
 * region could be resolved from config, environment, or profile.
 */
export class ConfigurationError extends WrapsSMSError {
  /**
   * The underlying AWS SDK error, for callers that need the raw detail
   */
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ConfigurationError';
    this.cause = cause;
  }
}

/**
 * The account-level restriction that blocked a send.
 *
 * These map onto documented AWS End User Messaging SMS failure reasons rather
 * than a single "sandbox" concept, because AWS distinguishes them: an
 * unverified destination is sandbox-specific, while a spend limit or a
 * country/identity mismatch can hit a production account too.
 */
export type SendingRestriction =
  /** Sandbox only: the destination number has not been verified */
  | 'SANDBOX_DESTINATION_NOT_VERIFIED'
  /** Sandbox only: the account already holds the maximum verified destinations */
  | 'SANDBOX_VERIFIED_DESTINATION_LIMIT'
  /** No phone number, sender ID, or pool exists to send from in this region */
  | 'NO_ORIGINATION_IDENTITY'
  /** The monthly SMS spend limit was reached ($1.00 USD while in the sandbox) */
  | 'SPEND_LIMIT_REACHED'
  /** The origination identity cannot send to the destination's country */
  | 'ORIGINATION_IDENTITY_COUNTRY_MISMATCH'
  /** Sending to the destination country is blocked for this account */
  | 'DESTINATION_COUNTRY_BLOCKED'
  /** AWS disabled or paused the account's ability to send */
  | 'ACCOUNT_DISABLED';

/**
 * Error thrown when AWS refuses a send because of an account-level sending
 * restriction rather than a problem with the request.
 *
 * A brand new AWS account is in the AWS End User Messaging SMS sandbox, where
 * sends are limited to verified destination numbers and $1.00 (USD) per month.
 * That is the most common cause, and the one this SDK is most likely to
 * surface on a first send.
 *
 * @see https://docs.aws.amazon.com/sms-voice/latest/userguide/sandbox.html
 */
export class SendingRestrictionError extends WrapsSMSError {
  /**
   * Which restriction applied, normalized across AWS exception types
   */
  public readonly restriction: SendingRestriction;

  /**
   * The raw AWS `Reason` value (e.g. 'DESTINATION_PHONE_NUMBER_NOT_VERIFIED')
   */
  public readonly awsReason?: string;

  /**
   * Whether this restriction only exists while the account is in the sandbox
   */
  public readonly sandboxOnly: boolean;

  /**
   * AWS request ID for debugging
   */
  public readonly requestId?: string;

  constructor(
    message: string,
    restriction: SendingRestriction,
    options: { awsReason?: string; sandboxOnly?: boolean; requestId?: string } = {}
  ) {
    super(message);
    this.name = 'SendingRestrictionError';
    this.restriction = restriction;
    this.awsReason = options.awsReason;
    this.sandboxOnly = options.sandboxOnly ?? false;
    this.requestId = options.requestId;
  }
}
