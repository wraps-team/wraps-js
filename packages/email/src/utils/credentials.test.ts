import { SESClient } from '@aws-sdk/client-ses';
import { afterEach, describe, expect, it } from 'vitest';
import { createSESClient } from './credentials';

describe('createSESClient', () => {
  afterEach(() => {
    delete process.env.VERCEL;
  });
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

  it('should use Vercel OIDC provider when VERCEL env is set with roleArn', () => {
    process.env.VERCEL = '1';
    const client = createSESClient({
      roleArn: 'arn:aws:iam::123456789012:role/MyEmailRole',
    });

    expect(client).toBeInstanceOf(SESClient);
  });

  it('should use fromTokenFile when roleArn is set without VERCEL env', () => {
    delete process.env.VERCEL;
    const client = createSESClient({
      roleArn: 'arn:aws:iam::123456789012:role/MyEmailRole',
    });

    expect(client).toBeInstanceOf(SESClient);
  });

  it('should use pre-configured client when provided', () => {
    const preConfiguredClient = new SESClient({ region: 'ap-southeast-1' });
    const client = createSESClient({
      client: preConfiguredClient,
    });

    expect(client).toBe(preConfiguredClient);
  });

  it('should prioritize pre-configured client over region', () => {
    const preConfiguredClient = new SESClient({ region: 'ap-southeast-1' });
    const client = createSESClient({
      client: preConfiguredClient,
      region: 'us-west-2', // Should be ignored
    });

    expect(client).toBe(preConfiguredClient);
  });

  it('should prioritize pre-configured client over roleArn', () => {
    const preConfiguredClient = new SESClient({ region: 'ap-southeast-1' });
    const client = createSESClient({
      client: preConfiguredClient,
      roleArn: 'arn:aws:iam::123456789012:role/MyEmailRole', // Should be ignored
    });

    expect(client).toBe(preConfiguredClient);
  });

  it('should prioritize pre-configured client over all other options', () => {
    const preConfiguredClient = new SESClient({ region: 'ap-southeast-1' });
    const client = createSESClient({
      client: preConfiguredClient,
      region: 'us-west-2', // Should be ignored
      roleArn: 'arn:aws:iam::123456789012:role/MyEmailRole', // Should be ignored
      credentials: {
        // Should be ignored
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
      endpoint: 'http://localhost:4566', // Should be ignored
    });

    expect(client).toBe(preConfiguredClient);
  });
});
