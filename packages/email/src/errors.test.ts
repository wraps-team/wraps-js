import { describe, expect, it } from 'vitest';
import { SESError, ValidationError, WrapsEmailError } from './errors';

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
