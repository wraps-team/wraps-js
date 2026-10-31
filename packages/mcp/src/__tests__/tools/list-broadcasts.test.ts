import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerListBroadcasts } from '../../tools/list-broadcasts.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

const BROADCAST_A = {
  id: 'bcs_1',
  name: 'October digest',
  status: 'completed',
  channel: 'email',
  subject: 'Your October digest',
  totalRecipients: 120,
  processedRecipients: 120,
  sent: 118,
  delivered: 115,
  opened: 60,
  clicked: 12,
  bounced: 2,
  complained: 0,
  suppressed: 2,
  failed: 0,
  scheduledFor: null,
  startedAt: '2026-10-01T10:00:00.000Z',
  completedAt: '2026-10-01T10:05:00.000Z',
  createdAt: '2026-10-01T09:58:00.000Z',
  template: { id: 'tpl_1', name: 'Digest' },
  awsAccount: { id: 'aws_1', name: 'Prod', region: 'us-east-1' },
};

const BROADCAST_B = {
  id: 'bcs_2',
  name: null,
  status: 'draft',
  channel: 'sms',
  subject: null,
  totalRecipients: 0,
  processedRecipients: 0,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  complained: 0,
  suppressed: 0,
  failed: 0,
  scheduledFor: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-10-02T08:00:00.000Z',
  template: null,
  awsAccount: null,
};

describe('list_broadcasts', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('lists the first page with pinned structuredContent and the exact query sent', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/batch',
        query: { page: '1', pageSize: '2' },
        body: { data: [BROADCAST_A, BROADCAST_B], page: 1, pageSize: 2, total: 3 },
      },
    ]);
    client = await connectTool(registerListBroadcasts, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_broadcasts',
      arguments: { page: 1, pageSize: 2 },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      broadcasts: [
        {
          id: 'bcs_1',
          name: 'October digest',
          status: 'completed',
          channel: 'email',
          subject: 'Your October digest',
          totalRecipients: 120,
          processedRecipients: 120,
          sent: 118,
          delivered: 115,
          opened: 60,
          clicked: 12,
          bounced: 2,
          complained: 0,
          suppressed: 2,
          failed: 0,
          scheduledFor: null,
          startedAt: '2026-10-01T10:00:00.000Z',
          completedAt: '2026-10-01T10:05:00.000Z',
          createdAt: '2026-10-01T09:58:00.000Z',
          template: { id: 'tpl_1', name: 'Digest' },
          awsAccount: { id: 'aws_1', name: 'Prod', region: 'us-east-1' },
        },
        {
          id: 'bcs_2',
          name: null,
          status: 'draft',
          channel: 'sms',
          subject: null,
          totalRecipients: 0,
          processedRecipients: 0,
          sent: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          bounced: 0,
          complained: 0,
          suppressed: 0,
          failed: 0,
          scheduledFor: null,
          startedAt: null,
          completedAt: null,
          createdAt: '2026-10-02T08:00:00.000Z',
          template: null,
          awsAccount: null,
        },
      ],
      page: 1,
      pageSize: 2,
      total: 3,
      hasMore: true,
    });
    expect(result.content[0].text).toContain('Returned 2 of 3');
    expect(result.content[0].text).toContain('page 2');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/batch');
    expect(api.calls[0].query).toEqual({ page: '1', pageSize: '2' });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('continues pagination: the page and filters are passed through and hasMore turns false on the last page', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/batch',
        query: { page: '2', pageSize: '2', status: 'draft', channel: 'sms', search: 'digest' },
        body: { data: [BROADCAST_B], page: 2, pageSize: 2, total: 3 },
      },
    ]);
    client = await connectTool(registerListBroadcasts, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_broadcasts',
      arguments: { page: 2, pageSize: 2, status: 'draft', channel: 'sms', search: 'digest' },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      page: 2,
      pageSize: 2,
      total: 3,
      hasMore: false,
    });
    expect(result.structuredContent).toHaveProperty('broadcasts');
    expect(result.structuredContent?.broadcasts).toHaveLength(1);
    expect(result.content[0].text).toContain('This is the last page');
    expect(api.calls[0].query).toEqual({
      page: '2',
      pageSize: '2',
      status: 'draft',
      channel: 'sms',
      search: 'digest',
    });
  });

  it('maps a 403 from the API to an actionable tool error', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/batch',
        query: { page: '1', pageSize: '20' },
        status: 403,
        body: { error: 'Missing broadcasts read permission', code: 'FORBIDDEN' },
      },
    ]);
    client = await connectTool(registerListBroadcasts, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_broadcasts',
      arguments: {},
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
    expect(result.content[0].text).toContain('code: FORBIDDEN');
    expect(result.content[0].text).toContain('Ask an organization admin');
    expect(api.calls).toHaveLength(1);
  });
});
