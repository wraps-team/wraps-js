import { describe, expect, it } from 'vitest';
import { createPlatformClient } from './client';

describe('createPlatformClient', () => {
  it('creates a client with the provided config', () => {
    const client = createPlatformClient({
      apiKey: 'test-api-key',
    });

    expect(client).toBeDefined();
    expect(client.GET).toBeDefined();
    expect(client.POST).toBeDefined();
    expect(client.PATCH).toBeDefined();
    expect(client.DELETE).toBeDefined();
  });

  it('uses custom baseUrl when provided', () => {
    const client = createPlatformClient({
      apiKey: 'test-api-key',
      baseUrl: 'https://custom.api.com',
    });

    expect(client).toBeDefined();
  });
});
