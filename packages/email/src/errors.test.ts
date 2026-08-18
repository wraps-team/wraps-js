import { describe, expect, it } from 'vitest';
import {
  CredentialsError,
  isCredentialsChainError,
  isUnverifiedIdentityError,
  mapAwsSdkError,
  SandboxError,
  SES_SIMULATOR_SUCCESS,
  SESError,
  ValidationError,
  WrapsEmailError,
} from './errors';

describe('WrapsEmailError', () => {
  it('should create an error with the correct name and message', () => {
    const error = new WrapsEmailError('Test error');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WrapsEmailError');
    expect(error.message).toBe('Test error');
  });
});

describe('ValidationError', () => {
  it('should create a validation error with message only', () => {
    const error = new ValidationError('Invalid email');

    expect(error).toBeInstanceOf(WrapsEmailError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('Invalid email');
    expect(error.field).toBeUndefined();
  });

  it('should create a validation error with field', () => {
    const error = new ValidationError('Invalid email', 'from');

    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('Invalid email');
    expect(error.field).toBe('from');
  });
});

describe('SESError', () => {
  it('should create an SES error with all properties', () => {
    const error = new SESError('Rate limit exceeded', 'Throttling', 'abc-123-def', true);

    expect(error).toBeInstanceOf(WrapsEmailError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SESError');
    expect(error.message).toBe('Rate limit exceeded');
    expect(error.code).toBe('Throttling');
    expect(error.requestId).toBe('abc-123-def');
    expect(error.retryable).toBe(true);
  });

  it('should create a non-retryable SES error', () => {
    const error = new SESError('Message rejected', 'MessageRejected', 'xyz-456', false);

    expect(error.retryable).toBe(false);
  });
});

describe('mapAwsSdkError', () => {
  it('should map an AWS SDK error with all fields to a SESError', () => {
    const sdkError = {
      $metadata: { requestId: 'req-abc-123' },
      $retryable: { throttling: true },
      message: 'Rate limit exceeded',
      name: 'ThrottlingException',
    };

    const result = mapAwsSdkError(sdkError);

    expect(result).toBeInstanceOf(SESError);
    const sesError = result as SESError;
    expect(sesError.message).toBe('Rate limit exceeded');
    expect(sesError.code).toBe('ThrottlingException');
    expect(sesError.requestId).toBe('req-abc-123');
    expect(sesError.retryable).toBe(true);
  });

  it('should return retryable: false when $retryable is absent', () => {
    const sdkError = {
      $metadata: { requestId: 'req-xyz-456' },
      message: 'Message rejected',
      name: 'MessageRejected',
    };

    const result = mapAwsSdkError(sdkError) as SESError;

    expect(result).toBeInstanceOf(SESError);
    expect(result.retryable).toBe(false);
  });

  it('should return a plain Error unchanged when $metadata is absent', () => {
    const original = new Error('boom');

    const result = mapAwsSdkError(original);

    expect(result).toBe(original);
    expect(result).toBeInstanceOf(Error);
    expect(result).not.toBeInstanceOf(SESError);
  });
});

describe('credential failures', () => {
  // What the AWS SDK actually throws with an empty environment, measured in the
  // audit: no $metadata, so it never reached AWS.
  const credentialChainError = Object.assign(
    new Error('Could not load credentials from any providers'),
    { name: 'CredentialsProviderError' }
  );

  it('recognizes the credential-chain failure', () => {
    expect(isCredentialsChainError(credentialChainError)).toBe(true);
  });

  it('does not treat an error that reached AWS as a credential-chain failure', () => {
    expect(
      isCredentialsChainError({
        $metadata: { requestId: 'req-1' },
        name: 'InvalidClientTokenId',
        message: 'The security token included in the request is invalid.',
      })
    ).toBe(false);
  });

  it('wraps it in the SDK error hierarchy instead of leaking raw AWS text', () => {
    const mapped = mapAwsSdkError(credentialChainError);

    expect(mapped).toBeInstanceOf(CredentialsError);
    expect(mapped).toBeInstanceOf(WrapsEmailError);
    expect(mapped.name).toBe('CredentialsError');
  });

  it('lists every credential option without ranking one, and keeps the original error', () => {
    const mapped = mapAwsSdkError(credentialChainError) as CredentialsError;

    expect(mapped.message).toContain("Wraps couldn't find working AWS credentials");
    expect(mapped.message).toContain('aws sso login');
    expect(mapped.message).toContain('aws configure');
    expect(mapped.message).toContain('AWS_ACCESS_KEY_ID');
    expect(mapped.message).toContain('AWS_PROFILE');
    expect(mapped.message).toContain('new WrapsEmail({ credentials:');
    expect(mapped.message).toContain(
      'Original AWS error: Could not load credentials from any providers'
    );
    expect(mapped.cause).toBe(credentialChainError);
    // Neutral: no option is recommended, preferred, or called easiest.
    expect(mapped.message).not.toMatch(/recommend|preferred|easiest|best|should use/i);
  });

  it('wraps an expired SSO session too', () => {
    const mapped = mapAwsSdkError(
      new Error('The SSO session associated with this profile has expired')
    );

    expect(mapped).toBeInstanceOf(CredentialsError);
  });
});

describe('unverified identity (sandbox vs region mismatch)', () => {
  const rejection = {
    $metadata: { requestId: 'req-sandbox-1' },
    name: 'MessageRejected',
    message:
      'Email address is not verified. The following identities failed the check in region US-EAST-1: user@example.com',
  };

  it('detects the rejection', () => {
    expect(isUnverifiedIdentityError(rejection)).toBe(true);
  });

  it('does not fire for a suspended account, where sandbox guidance would be wrong', () => {
    expect(
      isUnverifiedIdentityError({
        $metadata: {},
        name: 'MessageRejected',
        message: 'Account is paused for sending.',
      })
    ).toBe(false);
  });

  it('maps to a SandboxError that still satisfies existing SESError handling', () => {
    const mapped = mapAwsSdkError(rejection, 'SES request failed', { region: 'eu-west-1' });

    expect(mapped).toBeInstanceOf(SandboxError);
    expect(mapped).toBeInstanceOf(SESError);
    expect(mapped).toBeInstanceOf(WrapsEmailError);
    expect((mapped as SandboxError).code).toBe('MessageRejected');
    expect((mapped as SandboxError).requestId).toBe('req-sandbox-1');
    expect((mapped as SandboxError).region).toBe('eu-west-1');
  });

  it('names the region actually used, so a region mismatch is distinguishable', () => {
    const mapped = mapAwsSdkError(rejection, 'SES request failed', { region: 'eu-west-1' });

    expect(mapped.message).toContain('region eu-west-1');
    expect(mapped.message).toContain('Region mismatch');
    expect(mapped.message).toContain('SES identities are per-region');
    expect(mapped.message).toContain('AWS_REGION');
    expect(mapped.message).toContain('--region eu-west-1');
  });

  it('offers the simulator first and is honest about production access', () => {
    const mapped = mapAwsSdkError(rejection, 'SES request failed', { region: 'us-east-1' });

    expect(mapped.message).toContain('SES sandbox');
    expect(mapped.message).toContain(SES_SIMULATOR_SUCCESS);
    expect(mapped.message).toContain('this SDK cannot do it for you');
    // The raw SES text survives for anyone grepping logs.
    expect(mapped.message).toContain('Email address is not verified');
    // Cheapest option first.
    expect(mapped.message.indexOf(SES_SIMULATOR_SUCCESS)).toBeLessThan(
      mapped.message.indexOf('Request SES production access')
    );
  });

  it('still produces usable guidance when the region could not be resolved', () => {
    const mapped = mapAwsSdkError(rejection, 'SES request failed', {});

    expect(mapped).toBeInstanceOf(SandboxError);
    expect(mapped.message).toContain('the region this client resolved');
    expect(mapped.message).toContain(SES_SIMULATOR_SUCCESS);
  });

  it('leaves an unrelated SES failure as a plain SESError', () => {
    const mapped = mapAwsSdkError({
      $metadata: { requestId: 'req-2' },
      name: 'Throttling',
      message: 'Maximum sending rate exceeded.',
      $retryable: { throttling: true },
    });

    expect(mapped).toBeInstanceOf(SESError);
    expect(mapped).not.toBeInstanceOf(SandboxError);
    expect(mapped.message).toBe('Maximum sending rate exceeded.');
  });
});
