export class WrapsEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrapsEmailError';
  }
}

export class ValidationError extends WrapsEmailError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class SESError extends WrapsEmailError {
  public readonly code: string;
  public readonly requestId: string;
  public readonly retryable: boolean;

  constructor(message: string, code: string, requestId: string, retryable: boolean) {
    super(message);
    this.name = 'SESError';
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

export class DynamoDBError extends WrapsEmailError {
  public readonly code: string;
  public readonly requestId: string;
  public readonly retryable: boolean;

  constructor(message: string, code: string, requestId: string, retryable: boolean) {
    super(message);
    this.name = 'DynamoDBError';
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

/**
 * SES refused the send because an identity involved isn't verified in the
 * region the request went to. Extends {@link SESError} so existing
 * `instanceof SESError` handling keeps working.
 *
 * Two unrelated causes produce this one AWS error — a region mismatch and the
 * SES sandbox — so {@link SandboxError.region} records which region the request
 * actually used, and the message walks through both.
 */
export class SandboxError extends SESError {
  /** The region this client sent to, when it could be resolved. */
  public readonly region?: string;

  constructor(
    message: string,
    code: string,
    requestId: string,
    retryable: boolean,
    region?: string
  ) {
    super(message, code, requestId, retryable);
    this.name = 'SandboxError';
    this.region = region;
  }
}

/**
 * The AWS credential chain produced nothing usable, so no request was ever
 * signed. Extends {@link WrapsEmailError} so a single `instanceof` check
 * really does cover every error this SDK throws.
 */
export class CredentialsError extends WrapsEmailError {
  /** The underlying AWS SDK error, kept for debugging. */
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CredentialsError';
    this.cause = cause;
  }
}

/**
 * AWS pre-verifies this address, so a sandboxed account can send to it with no
 * recipient verification and get a real Delivery event back. Mirrors
 * `SES_SIMULATOR_ADDRESSES.SUCCESS` in the wraps CLI
 * (`packages/cli/src/utils/email/ses-simulator.ts`) and `SES_SIMULATOR_SUCCESS`
 * in `@wraps.dev/mcp`.
 */
export const SES_SIMULATOR_SUCCESS = 'success@simulator.amazonses.com';

// Deliberately neutral: every way credentials can be supplied, listed without
// ranking one over another. Wording tracks CREDENTIAL_OPTIONS in the wraps CLI
// at packages/cli/src/utils/shared/errors.ts.
const CREDENTIAL_OPTIONS = `Wraps couldn't find working AWS credentials. Any of these work:

AWS SSO:
  aws configure sso
  aws sso login

IAM access keys:
  aws configure

Environment variables:
  export AWS_ACCESS_KEY_ID=<your-key>
  export AWS_SECRET_ACCESS_KEY=<your-secret>

Existing profile:
  export AWS_PROFILE=<profile-name>

Passed to the client:
  new WrapsEmail({ credentials: { accessKeyId, secretAccessKey } })`;

/**
 * True when the AWS credential chain itself failed, meaning nothing was ever
 * sent. AWS SDK v3 error names are unreliable, so check name AND message.
 * An error carrying `$metadata` reached AWS and is therefore never this.
 */
export function isCredentialsChainError(error: unknown): boolean {
  const err = error as { name?: string; message?: string; $metadata?: unknown };
  if (err?.$metadata) {
    return false;
  }
  const name = typeof err?.name === 'string' ? err.name : '';
  const message = typeof err?.message === 'string' ? err.message : '';
  return (
    name === 'CredentialsProviderError' ||
    name === 'TokenProviderError' ||
    message.includes('Could not load credentials from any providers') ||
    message.includes('Credential is missing') ||
    (message.includes('Profile') && message.includes('could not be found')) ||
    message.includes('SSO session associated with this profile has expired')
  );
}

/**
 * True when SES rejected the send because an identity is not verified in the
 * region the request went to.
 *
 * Narrower on purpose than `isUnverifiedRecipientError()` in `@wraps.dev/mcp`,
 * which treats every `MessageRejected` as a sandbox rejection — SES also uses
 * that code for suspended and paused accounts, where sandbox guidance is wrong.
 */
export function isUnverifiedIdentityError(error: unknown): boolean {
  const err = error as { name?: string; message?: string };
  const message = typeof err?.message === 'string' ? err.message : '';
  return /not verified/i.test(message);
}

/**
 * Guidance for an unverified-identity rejection.
 *
 * A region mismatch and a sandbox block produce the *same* AWS text, so the
 * message names the region actually used and separates the two causes rather
 * than sending the developer off to re-verify an identity that is already
 * verified somewhere else.
 */
export function buildUnverifiedIdentityGuidance(
  originalMessage: string,
  region: string | undefined
): string {
  const where = region ? `region ${region}` : 'the region this client resolved';
  const regionFlag = region ? ` --region ${region}` : '';

  return [
    `SES rejected this send: ${originalMessage}`,
    '',
    `The identity check ran in ${where}. Two unrelated things produce this error — rule them out in this order:`,
    '',
    `1. Region mismatch. SES identities are per-region, and this client used ${where}. If you verified the domain or address in a different region, ${where} has never heard of it and re-verifying will not help. Set AWS_REGION, or pass \`region\` to the WrapsEmail constructor, to send where the identity lives.`,
    '',
    '2. SES sandbox. A sandboxed AWS account can only send TO verified recipients. Options, cheapest first:',
    `   a. Send to the AWS mailbox simulator instead: to: "${SES_SIMULATOR_SUCCESS}". AWS pre-verifies it, so it proves your sender and pipeline work with no production access, and produces a real Delivery event.`,
    '   b. Verify the intended recipient as an SES identity in this account, then retry. Verified identities can both send and receive while in the sandbox.',
    '   c. Request SES production access to send to anyone. That is an AWS support review, and this SDK cannot do it for you.',
    '',
    'To tell which one you are hitting:',
    `  aws sesv2 get-account${regionFlag}            # productionAccessEnabled: false means sandbox`,
    `  aws sesv2 list-email-identities${regionFlag}  # what is verified in this region`,
    `  npx wraps email status${regionFlag}`,
  ].join('\n');
}

/**
 * Map an AWS SDK v3 client error into this SDK's error hierarchy. AWS SDK
 * errors carry `$metadata` (with `requestId`) and an optional
 * `$retryable.throttling` flag. Credential-chain failures never reach AWS and
 * so carry neither — they become a {@link CredentialsError}. Non-AWS errors
 * are returned unchanged.
 *
 * @param error - The caught error from an AWS SDK `.send()` call.
 * @param fallbackMessage - Message used when the error has no `.message`.
 * @param options.region - Region the failing request used, named in
 *   unverified-identity guidance so a region mismatch is distinguishable from
 *   a sandbox block.
 * @returns A `CredentialsError`, `SandboxError`, or `SESError` when the error
 *   is recognized, else the original error.
 */
export function mapAwsSdkError(
  error: unknown,
  fallbackMessage = 'SES request failed',
  options: { region?: string } = {}
): Error {
  const err = error as {
    $metadata?: { requestId?: string };
    $retryable?: { throttling?: boolean };
    message?: string;
    name?: string;
  };

  if (isCredentialsChainError(error)) {
    const detail = err.message || fallbackMessage;
    return new CredentialsError(`${CREDENTIAL_OPTIONS}\n\nOriginal AWS error: ${detail}`, error);
  }

  if (err.$metadata) {
    const message = err.message || fallbackMessage;
    const code = err.name || 'Unknown';
    const requestId = err.$metadata.requestId || 'unknown';
    const retryable = err.$retryable?.throttling || false;

    if (isUnverifiedIdentityError(error)) {
      return new SandboxError(
        buildUnverifiedIdentityGuidance(message, options.region),
        code,
        requestId,
        retryable,
        options.region
      );
    }

    return new SESError(message, code, requestId, retryable);
  }

  return error as Error;
}
