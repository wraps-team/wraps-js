import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  CredentialsError,
  OptedOutError,
  RateLimitError,
  SendingRestrictionError,
  SMSError,
  WrapsSMSError,
} from '../errors';
import { mapAwsSMSError } from './aws-errors';

/**
 * Shapes mirror what @aws-sdk/client-pinpoint-sms-voice-v2 actually throws:
 * a named exception carrying an optional `Reason` from the documented
 * enumeration, plus $metadata.
 */
function awsException(
  name: string,
  extra: Record<string, unknown> = {},
  message = 'AWS said no'
): Error {
  const err = new Error(message);
  err.name = name;
  return Object.assign(err, { $metadata: { requestId: 'req-abc' } }, extra);
}

describe('credential failures', () => {
  it('wraps CredentialsProviderError in the SDK error hierarchy', () => {
    const raw = new Error('Could not load credentials from any providers');
    raw.name = 'CredentialsProviderError';

    const mapped = mapAwsSMSError(raw);

    expect(mapped).toBeInstanceOf(CredentialsError);
    expect(mapped).toBeInstanceOf(WrapsSMSError);
  });

  it('lists every credential option without ranking them', () => {
    const raw = new Error('Could not load credentials from any providers');
    raw.name = 'CredentialsProviderError';

    const mapped = mapAwsSMSError(raw) as CredentialsError;

    expect(mapped.message).toContain('aws configure sso');
    expect(mapped.message).toContain('aws configure');
    expect(mapped.message).toContain('AWS_ACCESS_KEY_ID');
    expect(mapped.message).toContain('AWS_PROFILE');
    expect(mapped.message).not.toMatch(/recommend|preferred|best|instead use/i);
  });

  it('preserves the raw AWS text and the original error', () => {
    const raw = new Error('Could not load credentials from any providers');
    raw.name = 'CredentialsProviderError';

    const mapped = mapAwsSMSError(raw) as CredentialsError;

    expect(mapped.message).toContain('AWS reported: Could not load credentials');
    expect(mapped.cause).toBe(raw);
  });

  it('catches expired SSO sessions, which arrive with a generic name', () => {
    const raw = new Error('The SSO session associated with this profile has expired.');

    expect(mapAwsSMSError(raw)).toBeInstanceOf(CredentialsError);
  });

  it('catches an invalid security token', () => {
    const mapped = mapAwsSMSError(
      awsException(
        'UnrecognizedClientException',
        {},
        'The security token included in the request is invalid.'
      )
    );

    expect(mapped).toBeInstanceOf(CredentialsError);
  });
});

describe('region failures', () => {
  it('maps the AWS SDK region resolver error to ConfigurationError', () => {
    const mapped = mapAwsSMSError(new Error('Region is missing'));

    expect(mapped).toBeInstanceOf(ConfigurationError);
    expect(mapped).toBeInstanceOf(WrapsSMSError);
  });

  it('lists every way to set a region without ranking them', () => {
    const mapped = mapAwsSMSError(new Error('Region is missing'));

    expect(mapped.message).toContain("new WrapsSMS({ region: 'us-east-1' })");
    expect(mapped.message).toContain('AWS_REGION');
    expect(mapped.message).toContain('AWS_DEFAULT_REGION');
    expect(mapped.message).toContain('AWS_PROFILE');
  });
});

describe('sandbox and sending restrictions', () => {
  it('maps DESTINATION_PHONE_NUMBER_NOT_VERIFIED to a sandbox restriction', () => {
    const mapped = mapAwsSMSError(
      awsException('ConflictException', { Reason: 'DESTINATION_PHONE_NUMBER_NOT_VERIFIED' }),
      { destination: '+14155551234' }
    ) as SendingRestrictionError;

    expect(mapped).toBeInstanceOf(SendingRestrictionError);
    expect(mapped.restriction).toBe('SANDBOX_DESTINATION_NOT_VERIFIED');
    expect(mapped.awsReason).toBe('DESTINATION_PHONE_NUMBER_NOT_VERIFIED');
    expect(mapped.sandboxOnly).toBe(true);
    expect(mapped.requestId).toBe('req-abc');
  });

  it('names the destination and offers the simulator, verify, and production paths', () => {
    const mapped = mapAwsSMSError(
      awsException('ConflictException', { Reason: 'DESTINATION_PHONE_NUMBER_NOT_VERIFIED' }),
      { destination: '+14155551234' }
    );

    expect(mapped.message).toContain('+14155551234');
    // The US success simulator number, per AWS's simulator documentation.
    expect(mapped.message).toContain('+14254147755');
    expect(mapped.message).toContain('npx wraps sms verify-number');
    expect(mapped.message).toContain('production access');
    // Honest about what the SDK cannot do for you.
    expect(mapped.message).toContain('Wraps cannot');
  });

  it('states the real sandbox limits: 10 destinations and $1.00 a month', () => {
    const notVerified = mapAwsSMSError(
      awsException('ConflictException', { Reason: 'DESTINATION_PHONE_NUMBER_NOT_VERIFIED' })
    );
    expect(notVerified.message).toContain('10 per account');
    expect(notVerified.message).toContain('$1.00');
  });

  it('maps NO_ORIGINATION_IDENTITIES_FOUND to setup guidance, not a sandbox claim', () => {
    const mapped = mapAwsSMSError(
      awsException('ConflictException', { Reason: 'NO_ORIGINATION_IDENTITIES_FOUND' })
    ) as SendingRestrictionError;

    expect(mapped.restriction).toBe('NO_ORIGINATION_IDENTITY');
    expect(mapped.sandboxOnly).toBe(false);
    expect(mapped.message).toContain('npx wraps sms init');
    expect(mapped.message).toContain('per-region');
    expect(mapped.message).not.toContain('sandbox');
  });

  it('maps the monthly spend limit and does not call it sandbox-only', () => {
    const mapped = mapAwsSMSError(
      awsException('ServiceQuotaExceededException', {
        Reason: 'MONTHLY_SPEND_LIMIT_REACHED_FOR_TEXT',
      })
    ) as SendingRestrictionError;

    expect(mapped.restriction).toBe('SPEND_LIMIT_REACHED');
    expect(mapped.sandboxOnly).toBe(false);
    expect(mapped.message).toContain('$1.00');
  });

  it('maps the verified-destination cap to a sandbox-only restriction', () => {
    const mapped = mapAwsSMSError(
      awsException('ServiceQuotaExceededException', {
        Reason: 'VERIFIED_DESTINATION_NUMBERS_PER_ACCOUNT',
      })
    ) as SendingRestrictionError;

    expect(mapped.restriction).toBe('SANDBOX_VERIFIED_DESTINATION_LIMIT');
    expect(mapped.sandboxOnly).toBe(true);
    expect(mapped.message).toContain('24 hours');
  });

  it('maps an origination identity that cannot reach the destination country', () => {
    const mapped = mapAwsSMSError(
      awsException('ValidationException', {
        Reason: 'INVALID_IDENTITY_FOR_DESTINATION_COUNTRY',
      }),
      { destination: '+447860019066' }
    ) as SendingRestrictionError;

    expect(mapped.restriction).toBe('ORIGINATION_IDENTITY_COUNTRY_MISMATCH');
    expect(mapped.message).toContain('+447860019066');
  });

  it('maps a disabled account', () => {
    const mapped = mapAwsSMSError(
      awsException('AccessDeniedException', { Reason: 'ACCOUNT_DISABLED' })
    ) as SendingRestrictionError;

    expect(mapped.restriction).toBe('ACCOUNT_DISABLED');
    expect(mapped.message).toContain('disabled');
  });

  it('falls through to SMSError for a ConflictException reason it does not model', () => {
    const mapped = mapAwsSMSError(
      awsException('ConflictException', { Reason: 'RESOURCE_NOT_ACTIVE' })
    );

    expect(mapped).toBeInstanceOf(SMSError);
    expect(mapped).not.toBeInstanceOf(SendingRestrictionError);
  });
});

describe('opt-outs', () => {
  it('uses the documented reason code rather than message text', () => {
    const mapped = mapAwsSMSError(
      awsException(
        'ConflictException',
        { Reason: 'DESTINATION_PHONE_NUMBER_OPTED_OUT' },
        'Conflict'
      ),
      { destination: '+14155551234' }
    ) as OptedOutError;

    expect(mapped).toBeInstanceOf(OptedOutError);
    expect(mapped.phoneNumber).toBe('+14155551234');
  });

  it('still recognises the legacy message-only form', () => {
    const mapped = mapAwsSMSError(
      awsException('ConflictException', {}, 'Phone number +14155559999 has opted out')
    ) as OptedOutError;

    expect(mapped).toBeInstanceOf(OptedOutError);
    expect(mapped.phoneNumber).toBe('+14155559999');
  });
});

describe('unchanged behaviour', () => {
  it('maps ThrottlingException to RateLimitError', () => {
    expect(mapAwsSMSError(awsException('ThrottlingException'))).toBeInstanceOf(RateLimitError);
  });

  it('maps a retryable throttling flag to RateLimitError', () => {
    expect(
      mapAwsSMSError(awsException('SomeOtherException', { $retryable: { throttling: true } }))
    ).toBeInstanceOf(RateLimitError);
  });

  it('maps any other AWS error to SMSError with its code and request id', () => {
    const mapped = mapAwsSMSError(
      awsException('ValidationException', { Reason: 'INVALID_PARAMETER' }, 'Bad parameter')
    ) as SMSError;

    expect(mapped).toBeInstanceOf(SMSError);
    expect(mapped.code).toBe('ValidationException');
    expect(mapped.requestId).toBe('req-abc');
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toBe('Bad parameter');
  });

  it('passes through a non-AWS Error unchanged', () => {
    const raw = new Error('Invalid response from SMS service: missing MessageId');
    expect(mapAwsSMSError(raw)).toBe(raw);
  });

  it('wraps a non-Error throw', () => {
    const mapped = mapAwsSMSError('boom') as SMSError;
    expect(mapped).toBeInstanceOf(SMSError);
    expect(mapped.message).toBe('boom');
  });
});
