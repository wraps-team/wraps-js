import {
  ConfigurationError,
  CREDENTIAL_OPTIONS,
  CredentialsError,
  OptedOutError,
  RateLimitError,
  REGION_OPTIONS,
  type SendingRestriction,
  SendingRestrictionError,
  SMSError,
} from '../errors';

/**
 * Shape we read off an unknown thrown value. The AWS SDK's own exception
 * classes carry all of these, but errors thrown by the credential and region
 * resolvers do not, so everything is optional.
 */
interface AwsErrorLike {
  $metadata?: { requestId?: string };
  $retryable?: { throttling?: boolean };
  message?: string;
  name?: string;
  Reason?: string;
  ResourceId?: string;
  ResourceType?: string;
}

/**
 * Error names the AWS SDK uses when the credential chain itself fails, or when
 * the credentials it resolved are rejected. These never carry `$metadata` from
 * the SMS API, so without this list they escape the SDK's error hierarchy.
 */
const CREDENTIAL_ERROR_NAMES = new Set([
  'CredentialsProviderError',
  'ProviderError',
  'TokenProviderError',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidClientTokenId',
  'UnrecognizedClientException',
  'TokenRefreshRequired',
  'SSOTokenProviderFailure',
  'UnauthorizedSSOTokenError',
]);

/**
 * Substrings the SDK uses for credential failures that arrive with a generic
 * `Error` name. Matched only after the name check, so a well-named error never
 * depends on message text.
 */
const CREDENTIAL_MESSAGE_MARKERS = [
  'could not load credentials',
  'security token included in the request is invalid',
  'sso session associated with this profile has expired',
  'token has expired',
  'resolved credential object is not valid',
];

const SIMULATOR_DOCS =
  'https://docs.aws.amazon.com/sms-voice/latest/userguide/test-phone-numbers.html';
const SANDBOX_DOCS = 'https://docs.aws.amazon.com/sms-voice/latest/userguide/sandbox.html';

function isCredentialError(err: AwsErrorLike): boolean {
  if (err.name && CREDENTIAL_ERROR_NAMES.has(err.name)) {
    return true;
  }

  const message = err.message?.toLowerCase() ?? '';
  return CREDENTIAL_MESSAGE_MARKERS.some((marker) => message.includes(marker));
}

/**
 * The AWS SDK throws a bare `Error('Region is missing')` from its region
 * resolver when nothing in the chain supplies one. It has no name and no
 * metadata, so the message is the only signal available.
 */
function isMissingRegionError(err: AwsErrorLike): boolean {
  return (err.message ?? '').toLowerCase().includes('region is missing');
}

function sandboxDestinationNotVerified(destination?: string): string {
  const subject = destination ? `${destination} is` : 'That destination number is';

  return `${subject} not a verified destination number, and this AWS account is in the AWS End User Messaging SMS sandbox. In the sandbox you can only send to destination numbers you have verified, up to 10 per account.

Options, cheapest first:

1. Send to a simulator destination number instead. Simulator numbers exercise
   the full send path and produce real event records without going over a
   carrier network:
     United States  +14254147755 (success)  +14254147167 (failure)
     Other countries: ${SIMULATOR_DOCS}
   Note a simulator origination number can only send to simulator destinations
   in the same country.

2. Verify this number, which sends it a code you then enter:
     npx wraps sms verify-number

3. Request production access, which removes the verified-destination
   restriction and the $1.00 (USD) monthly sandbox spend limit. This is an AWS
   Support case and takes an initial response of up to 24 hours. Wraps cannot
   grant production access:
     ${SANDBOX_DOCS}

If your account is already out of the sandbox, check the region: verified
destinations and production access are both per-region.`;
}

function noOriginationIdentity(): string {
  return `This AWS account has no origination identity available to send from in this region. AWS End User Messaging needs a phone number, sender ID, or pool before it can send anything.

  npx wraps sms init        provision one (simulator, toll-free, or 10DLC)
  await sms.numbers.list()  see what already exists in this region

Origination identities are per-region. One provisioned in another region will
not be found here, so confirm the region before provisioning a second number.`;
}

function spendLimitReached(): string {
  return `This AWS account reached its monthly SMS spending limit, so AWS stopped sending.

Accounts in the AWS End User Messaging SMS sandbox have a fixed $1.00 (USD)
monthly limit that cannot be raised — leaving the sandbox is the only way to
lift it: ${SANDBOX_DOCS}

Accounts already in production have an account-level spend limit you can raise
through a service quota increase.`;
}

function verifiedDestinationLimit(): string {
  return `This AWS account already holds the maximum number of verified destination numbers. The sandbox allows 10 per account.

Free one up, or request production access to remove the limit entirely:
  ${SANDBOX_DOCS}

AWS requires waiting 24 hours after adding a destination number before it can
be deleted, so removing one you just added will not work immediately.`;
}

function identityCountryMismatch(destination?: string): string {
  const target = destination ? ` ${destination}` : '';

  return `The origination identity used cannot send to${target}. AWS End User Messaging enforces per-country rules: an origination identity is only valid for the countries it is registered for, and a simulator number can only send to simulator destinations in its own country.

  await sms.numbers.list()  check which numbers this region has, and their country

Sending to a new country generally means requesting and registering a number
for that country: npx wraps sms init`;
}

function destinationCountryBlocked(destination?: string): string {
  const target = destination ? ` ${destination}` : '';

  return `AWS blocked sending to${target}'s country for this account. This is an account or protect-configuration level restriction, not a problem with the message.

Check the destination country's requirements and any protect configuration on
the account before retrying.`;
}

function accountDisabled(reason?: string): string {
  const detail =
    reason === 'INSUFFICIENT_ACCOUNT_REPUTATION'
      ? "AWS flagged this account's SMS reputation as insufficient."
      : "AWS disabled or paused this account's ability to send SMS.";

  return `${detail} Sending stays blocked until AWS restores it — this is not something the SDK or Wraps can retry past.

AWS pauses accounts it observes sending suspicious traffic, and directs you to
the same production-access support case to restore sending:
  ${SANDBOX_DOCS}`;
}

/**
 * Map a `ConflictException` reason onto a typed restriction, if it is one.
 * Reasons not listed here fall through to a generic {@link SMSError}.
 */
function restrictionFromConflict(
  reason: string | undefined,
  destination: string | undefined
): { restriction: SendingRestriction; message: string; sandboxOnly: boolean } | undefined {
  switch (reason) {
    case 'DESTINATION_PHONE_NUMBER_NOT_VERIFIED':
      return {
        restriction: 'SANDBOX_DESTINATION_NOT_VERIFIED',
        message: sandboxDestinationNotVerified(destination),
        sandboxOnly: true,
      };
    case 'NO_ORIGINATION_IDENTITIES_FOUND':
      return {
        restriction: 'NO_ORIGINATION_IDENTITY',
        message: noOriginationIdentity(),
        sandboxOnly: false,
      };
    default:
      return undefined;
  }
}

function restrictionFromQuota(
  reason: string | undefined
): { restriction: SendingRestriction; message: string; sandboxOnly: boolean } | undefined {
  switch (reason) {
    case 'MONTHLY_SPEND_LIMIT_REACHED_FOR_TEXT':
    case 'MONTHLY_SPEND_LIMIT_REACHED_FOR_MEDIA':
      return {
        restriction: 'SPEND_LIMIT_REACHED',
        message: spendLimitReached(),
        sandboxOnly: false,
      };
    case 'VERIFIED_DESTINATION_NUMBERS_PER_ACCOUNT':
      return {
        restriction: 'SANDBOX_VERIFIED_DESTINATION_LIMIT',
        message: verifiedDestinationLimit(),
        sandboxOnly: true,
      };
    default:
      return undefined;
  }
}

function restrictionFromValidation(
  reason: string | undefined,
  destination: string | undefined
): { restriction: SendingRestriction; message: string; sandboxOnly: boolean } | undefined {
  switch (reason) {
    case 'INVALID_IDENTITY_FOR_DESTINATION_COUNTRY':
    case 'INTERNATIONAL_SENDING_NOT_SUPPORTED':
      return {
        restriction: 'ORIGINATION_IDENTITY_COUNTRY_MISMATCH',
        message: identityCountryMismatch(destination),
        sandboxOnly: false,
      };
    case 'DESTINATION_COUNTRY_BLOCKED':
      return {
        restriction: 'DESTINATION_COUNTRY_BLOCKED',
        message: destinationCountryBlocked(destination),
        sandboxOnly: false,
      };
    default:
      return undefined;
  }
}

/**
 * Convert anything thrown by the AWS SDK into a {@link WrapsSMSError}
 * subclass.
 *
 * Ordering matters. Credential and region failures come first because they
 * arrive without `$metadata` and would otherwise fall through to the generic
 * branch as raw AWS text.
 *
 * @param error - The value thrown by the AWS SDK
 * @param context.destination - Destination number of the request, used to
 *   name the number in opt-out and restriction messages
 */
export function mapAwsSMSError(error: unknown, context: { destination?: string } = {}): Error {
  const err = (error ?? {}) as AwsErrorLike;
  const requestId = err.$metadata?.requestId;

  if (isCredentialError(err)) {
    return new CredentialsError(
      `${CREDENTIAL_OPTIONS}\n\nAWS reported: ${err.message || 'Could not load credentials from any providers'}`,
      error
    );
  }

  if (isMissingRegionError(err)) {
    return new ConfigurationError(REGION_OPTIONS, error);
  }

  // Opt-out is reported as a ConflictException with a documented reason code.
  // The message match is kept as a fallback: `Reason` is optional in the API
  // model, so an older or partial response can arrive without it.
  if (err.name === 'ConflictException') {
    const optedOut =
      err.Reason === 'DESTINATION_PHONE_NUMBER_OPTED_OUT' ||
      (err.Reason === undefined && err.message?.includes('opted out'));

    if (optedOut) {
      const phoneNumber =
        context.destination || err.ResourceId || err.message?.match(/\+\d+/)?.[0] || 'unknown';
      return new OptedOutError(phoneNumber);
    }

    const restriction = restrictionFromConflict(err.Reason, context.destination);
    if (restriction) {
      return new SendingRestrictionError(restriction.message, restriction.restriction, {
        awsReason: err.Reason,
        sandboxOnly: restriction.sandboxOnly,
        requestId,
      });
    }
  }

  if (err.name === 'ServiceQuotaExceededException') {
    const restriction = restrictionFromQuota(err.Reason);
    if (restriction) {
      return new SendingRestrictionError(restriction.message, restriction.restriction, {
        awsReason: err.Reason,
        sandboxOnly: restriction.sandboxOnly,
        requestId,
      });
    }
  }

  if (err.name === 'ValidationException') {
    const restriction = restrictionFromValidation(err.Reason, context.destination);
    if (restriction) {
      return new SendingRestrictionError(restriction.message, restriction.restriction, {
        awsReason: err.Reason,
        sandboxOnly: restriction.sandboxOnly,
        requestId,
      });
    }
  }

  if (err.name === 'AccessDeniedException' && err.Reason) {
    return new SendingRestrictionError(accountDisabled(err.Reason), 'ACCOUNT_DISABLED', {
      awsReason: err.Reason,
      sandboxOnly: false,
      requestId,
    });
  }

  if (err.name === 'ThrottlingException' || err.$retryable?.throttling) {
    return new RateLimitError(err.message || 'Rate limit exceeded');
  }

  if (err.$metadata) {
    return new SMSError(
      err.message || 'SMS request failed',
      err.name || 'Unknown',
      requestId || 'unknown',
      err.$retryable?.throttling || false
    );
  }

  return error instanceof Error ? error : new SMSError(String(error), 'Unknown', 'unknown', false);
}
