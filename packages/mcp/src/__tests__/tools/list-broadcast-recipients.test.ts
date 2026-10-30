import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerListBroadcastRecipients } from '../../tools/list-broadcast-recipients.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

const RECIPIENT_A = {
  id: 'rcp_1',
  recipient: 'ada@example.com',
  status: 'bounced',
  error: null,
  bounceType: 'Permanent',
  bounceSubType: 'General',
  sentAt: '2026-10-01T10:01:00.000Z',
  createdAt: '2026-10-01T10:00:00.000Z',
};

const RECIPIENT_B = {
  id: 'rcp_2',
  recipient: 'grace@example.com',
  status: 'bounced',
  error: null,
  bounceType: 'Permanent',
  bounceSubType: 'NoEmail',
  sentAt: '2026-10-01T10:01:30.000Z',
  createdAt: '2026-10-01T10:00:00.000Z',
};

describe('list_broadcast_recipients', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('lists the first page with pinned structuredContent and the exact path and query sent', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/batch/bcs_1/recipients',
        query: { status: 'bounced', limit: '2', offset: '0' },
        body: { data: [RECIPIENT_A, RECIPIENT_B], limit: 2, offset: 0, total: 5 },
      },
    ]);
    client = await connectTool(registerListBroadcastRecipients, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_broadcast_recipients',
      arguments: { id: 'bcs_1', status: 'bounced', limit: 2 },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      recipients: [
        {
          id: 'rcp_1',
          recipient: 'ada@example.com',
          status: 'bounced',
          error: null,
          bounceType: 'Permanent',
          bounceSubType: 'General',
          sentAt: '2026-10-01T10:01:00.000Z',
          createdAt: '2026-10-01T10:00:00.000Z',
        },
        {
          id: 'rcp_2',
          recipient: 'grace@example.com',
          status: 'bounced',
          error: null,
          bounceType: 'Permanent',
          bounceSubType: 'NoEmail',
          sentAt: '2026-10-01T10:01:30.000Z',
          createdAt: '2026-10-01T10:00:00.000Z',
        },
      ],
      limit: 2,
      offset: 0,
      total: 5,
      hasMore: true,
    });
    expect(result.content[0].text).toContain('offset 2');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/batch/bcs_1/recipients');
    expect(api.calls[0].query).toEqual({ status: 'bounced', limit: '2', offset: '0' });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('continues pagination: offset is passed through and hasMore turns false on the last page', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/batch/bcs_1/recipients',
        query: { limit: '2', offset: '4' },
        body: { data: [RECIPIENT_B], limit: 2, offset: 4, total: 5 },
      },
    ]);
    client = await connectTool(registerListBroadcastRecipients, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_broadcast_recipients',
      arguments: { id: 'bcs_1', limit: 2, offset: 4 },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ offset: 4, total: 5, hasMore: false });
    expect(result.content[0].text).toContain('This is the last page');
    expect(api.calls[0].query).toEqual({ limit: '2', offset: '4' });
  });

  it('maps a 404 from the API (unknown broadcast) to an actionable tool error', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/batch/bcs_missing/recipients',
        query: { limit: '50', offset: '0' },
        status: 404,
        body: { error: 'Batch not found' },
      },
    ]);
    client = await connectTool(registerListBroadcastRecipients, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_broadcast_recipients',
      arguments: { id: 'bcs_missing' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not found in this organization');
    expect(result.content[0].text).toContain('matching list tool');
    expect(api.calls).toHaveLength(1);
  });
});
