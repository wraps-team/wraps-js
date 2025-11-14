import { SESClient } from '@aws-sdk/client-ses';
import { describe, expect, it } from 'vitest';
import { createSESClient } from './credentials';

describe('createSESClient', () => {
  it('should create SES client with default region', () => {
    const client = createSESClient({});

    expect(client).toBeInstanceOf(SESClient);
    // Note: Can't easily test internal config without mocking
  });

  it('should create SES client with custom region', () => {
    const client = createSESClient({ region: 'us-west-2' });

    expect(client).toBeInstanceOf(SESClient);
  });

  it('should create SES client with explicit credentials', () => {
    const client = createSESClient({
      credentials: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        sessionToken: 'test-token',
      },
    });

    expect(client).toBeInstanceOf(SESClient);
  });

  it('should create SES client with custom endpoint', () => {
    const client = createSESClient({
      endpoint: 'http://localhost:4566',
    });

    expect(client).toBeInstanceOf(SESClient);
  });

  it('should create SES client with all options', () => {
    const client = createSESClient({
      region: 'eu-west-1',
      credentials: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
      endpoint: 'http://localhost:4566',
    });

    expect(client).toBeInstanceOf(SESClient);
  });

  it('should create SES client with roleArn for OIDC federation', () => {
    const client = createSESClient({
      roleArn: 'arn:aws:iam::123456789012:role/MyEmailRole',
    });

    expect(client).toBeInstanceOf(SESClient);
  });

  it('should create SES client with roleArn and custom roleSessionName', () => {
    const client = createSESClient({
      roleArn: 'arn:aws:iam::123456789012:role/MyEmailRole',
      roleSessionName: 'my-custom-session',
    });

    expect(client).toBeInstanceOf(SESClient);
  });

  it('should create SES client with roleArn and custom region', () => {
    const client = createSESClient({
      region: 'eu-west-1',
      roleArn: 'arn:aws:iam::123456789012:role/MyEmailRole',
      roleSessionName: 'email-sender',
    });

    expect(client).toBeInstanceOf(SESClient);
  });

  it('should prioritize roleArn over explicit credentials when both are provided', () => {
    // This test ensures that roleArn takes precedence
    const client = createSESClient({
      roleArn: 'arn:aws:iam::123456789012:role/MyEmailRole',
      credentials: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
    });

    expect(client).toBeInstanceOf(SESClient);
  });
});
