import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGetBroadcast } from '../../tools/get-broadcast.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

const BROADCAST = {
  id: 'bcs_1',
  status: 'completed',
  channel: 'email',
  name: 'October digest',
  totalRecipients: 120,
  processedRecipients: 120,
  sent: 118,
  delivered: 115,
  failed: 1,
  opened: 60,
  clicked: 12,
  bounced: 2,
  complained: 0,
  suppressed: 2,
  startedAt: '2026-10-01T10:00:00.000Z',
  completedAt: '2026-10-01T10:05:00.000Z',
  createdAt: '2026-10-01T09:58:00.000Z',
};

describe('get_broadcast', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('returns one broadcast with pinned structuredContent and the encoded path sent', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/batch/bcs_1', body: BROADCAST }]);
    client = await connectTool(registerGetBroadcast, makeApiConfig());

    const result = (await client.callTool({
      name: 'get_broadcast',
      arguments: { id: 'bcs_1' },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: 'bcs_1',
      name: 'October digest',
      status: 'completed',
      channel: 'email',
      totalRecipients: 120,
      processedRecipients: 120,
      sent: 118,
      delivered: 115,
      failed: 1,
      opened: 60,
      clicked: 12,
      bounced: 2,
      complained: 0,
      suppressed: 2,
      startedAt: '2026-10-01T10:00:00.000Z',
      completedAt: '2026-10-01T10:05:00.000Z',
      createdAt: '2026-10-01T09:58:00.000Z',
    });
    expect(result.content[0].text).toContain('118 sent, 115 delivered');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/batch/bcs_1');
    expect(api.calls[0].query).toEqual({});
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('maps a 404 from the API to a not-found tool error that says what to check', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/batch/bcs_missing',
        status: 404,
        body: { error: 'Batch not found' },
      },
    ]);
    client = await connectTool(registerGetBroadcast, makeApiConfig());

    const result = (await client.callTool({
      name: 'get_broadcast',
      arguments: { id: 'bcs_missing' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not found in this organization');
    expect(result.content[0].text).toContain('matching list tool');
    expect(api.calls).toHaveLength(1);
  });
});
