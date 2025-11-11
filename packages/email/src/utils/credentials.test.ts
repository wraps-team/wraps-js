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
});
