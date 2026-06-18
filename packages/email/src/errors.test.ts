import { describe, expect, it } from 'vitest';
import { mapAwsSdkError, SESError, ValidationError, WrapsEmailError } from './errors';

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
