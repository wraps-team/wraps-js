import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGetBroadcastClicks } from '../../tools/get-broadcast-clicks.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

describe('get_broadcast_clicks', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('returns the breakdown with pinned structuredContent and the encoded path sent', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/batch/bcs_1/clicks',
        body: {
          data: [
            { url: 'https://wraps.dev/pricing', count: 9 },
            { url: 'https://wraps.dev/docs', count: 3 },
          ],
          unsubscribeCount: 4,
          totalDistinctUrls: 2,
          truncated: false,
        },
      },
    ]);
    client = await connectTool(registerGetBroadcastClicks, makeApiConfig());

    const result = (await client.callTool({
      name: 'get_broadcast_clicks',
      arguments: { id: 'bcs_1' },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: 'bcs_1',
      clicks: [
        { url: 'https://wraps.dev/pricing', count: 9 },
        { url: 'https://wraps.dev/docs', count: 3 },
      ],
      unsubscribeCount: 4,
      totalDistinctUrls: 2,
      truncated: false,
    });
    expect(result.content[0].text).toContain('Unsubscribe clicks: 4');
    expect(result.content[0].text).not.toContain('truncated');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/batch/bcs_1/clicks');
    expect(api.calls[0].query).toEqual({});
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('reports truncation: truncated stays true and the text says the rest are not listed', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/batch/bcs_1/clicks',
        body: {
          data: [{ url: 'https://wraps.dev/a', count: 1 }],
          unsubscribeCount: 0,
          totalDistinctUrls: 80,
          truncated: true,
        },
      },
    ]);
    client = await connectTool(registerGetBroadcastClicks, makeApiConfig());

    const result = (await client.callTool({
      name: 'get_broadcast_clicks',
      arguments: { id: 'bcs_1' },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ truncated: true, totalDistinctUrls: 80 });
    expect(result.content[0].text).toContain('Showing 1 of 80 distinct URLs');
  });

  it('maps a 404 from the API (unknown broadcast) to an actionable tool error', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/batch/bcs_missing/clicks',
        status: 404,
        body: { error: 'Batch not found' },
      },
    ]);
    client = await connectTool(registerGetBroadcastClicks, makeApiConfig());

    const result = (await client.callTool({
      name: 'get_broadcast_clicks',
      arguments: { id: 'bcs_missing' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not found in this organization');
    expect(result.content[0].text).toContain('matching list tool');
    expect(api.calls).toHaveLength(1);
  });
});
