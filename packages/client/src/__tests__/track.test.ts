import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlatformClient } from '../client';

describe('track', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('sends POST to /v1/events/ with name and options in body', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        success: true,
        contactCreated: false,
        workflowsTriggered: 1,
        executionsResumed: 0,
      })
    );

    const client = createPlatformClient({ apiKey: 'test-key' });
    await client.track('purchase.completed', {
      contactEmail: 'alice@example.com',
      properties: { orderId: 'ord_123', amount: 99 },
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [request] = mockFetch.mock.calls[0];
    expect(request.url).toContain('/v1/events/');
    expect(request.method).toBe('POST');

    const body = await request.json();
    expect(body).toEqual({
      name: 'purchase.completed',
      contactEmail: 'alice@example.com',
      properties: { orderId: 'ord_123', amount: 99 },
    });
  });

  it('returns unwrapped result on success', async () => {
    const apiResponse = {
      success: true,
      contactCreated: true,
      workflowsTriggered: 2,
      executionsResumed: 1,
    };
    mockFetch.mockResolvedValueOnce(Response.json(apiResponse));

    const client = createPlatformClient({ apiKey: 'test-key' });
    const result = await client.track('signup.completed', {
      contactEmail: 'bob@example.com',
      createIfMissing: true,
    });

    expect(result).toEqual(apiResponse);
  });

  it('throws on API error with the error message', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: 'Contact not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createPlatformClient({ apiKey: 'test-key' });
    await expect(client.track('purchase.completed', { contactId: 'nonexistent' })).rejects.toThrow(
      'Contact not found'
    );
  });

  it('includes Authorization header with API key', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        success: true,
        contactCreated: false,
        workflowsTriggered: 0,
        executionsResumed: 0,
      })
    );

    const client = createPlatformClient({ apiKey: 'wraps_sk_secret123' });
    await client.track('page.viewed');

    const [request] = mockFetch.mock.calls[0];
    expect(request.headers.get('Authorization')).toBe('Bearer wraps_sk_secret123');
  });
});

describe('trackBatch', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('sends POST to /v1/events/batch with events array', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        success: true,
        processed: 2,
        workflowsTriggered: 1,
        executionsResumed: 0,
        errors: [],
      })
    );

    const events = [
      { name: 'page.viewed', contactEmail: 'alice@example.com', properties: { page: '/pricing' } },
      { name: 'feature.used', contactId: 'con_abc', properties: { feature: 'api-keys' } },
    ];

    const client = createPlatformClient({ apiKey: 'test-key' });
    await client.trackBatch(events);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [request] = mockFetch.mock.calls[0];
    expect(request.url).toContain('/v1/events/batch');
    expect(request.method).toBe('POST');

    const body = await request.json();
    expect(body).toEqual({ events });
  });

  it('returns unwrapped batch result with processed count and errors', async () => {
    const apiResponse = {
      success: true,
      processed: 3,
      workflowsTriggered: 2,
      executionsResumed: 1,
      errors: ['Event 2: contact not found'],
    };
    mockFetch.mockResolvedValueOnce(Response.json(apiResponse));

    const client = createPlatformClient({ apiKey: 'test-key' });
    const result = await client.trackBatch([
      { name: 'a', contactEmail: 'a@example.com' },
      { name: 'b', contactId: 'missing' },
      { name: 'c', contactEmail: 'c@example.com' },
    ]);

    expect(result).toEqual(apiResponse);
    expect(result.processed).toBe(3);
    expect(result.errors).toEqual(['Event 2: contact not found']);
  });
});
