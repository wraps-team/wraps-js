import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerListEvents } from '../../tools/list-events.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

const EVENT_A = {
  id: 'evt_1',
  eventName: 'purchase.completed',
  eventData: { amount: 4200 },
  createdAt: '2026-10-01T10:00:00.000Z',
  contactId: 'ctc_1',
  contactEmail: 'ada@example.com',
  contactFirstName: 'Ada',
  contactLastName: null,
};

const EVENT_B = {
  id: 'evt_2',
  eventName: 'purchase.completed',
  eventData: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  contactId: 'ctc_2',
  contactEmail: null,
  contactFirstName: null,
  contactLastName: null,
};

describe('list_events', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('lists the first page with pinned structuredContent and the exact query sent', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/events',
        query: { page: '1', pageSize: '2' },
        body: { events: [EVENT_A, EVENT_B], total: 3, page: 1, pageSize: 2 },
      },
    ]);
    client = await connectTool(registerListEvents, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_events',
      arguments: { page: 1, pageSize: 2 },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      events: [EVENT_A, EVENT_B],
      total: 3,
      page: 1,
      pageSize: 2,
      hasMore: true,
    });
    expect(result.content[0].text).toContain('Returned 2 of 3');
    expect(result.content[0].text).toContain('page 2');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/events');
    expect(api.calls[0].query).toEqual({ page: '1', pageSize: '2' });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('continues pagination: the page and filters are passed through and hasMore turns false on the last page', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/events',
        query: {
          page: '2',
          pageSize: '2',
          eventName: 'purchase.completed',
          search: 'ada',
          contactEmail: 'ada@example.com',
          dateFrom: '2026-10-01T00:00:00Z',
          dateTo: '2026-10-31T23:59:59Z',
        },
        body: { events: [EVENT_B], total: 3, page: 2, pageSize: 2 },
      },
    ]);
    client = await connectTool(registerListEvents, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_events',
      arguments: {
        page: 2,
        pageSize: 2,
        eventName: 'purchase.completed',
        search: 'ada',
        contactEmail: 'ada@example.com',
        dateFrom: '2026-10-01T00:00:00Z',
        dateTo: '2026-10-31T23:59:59Z',
      },
    })) as ToolResult;

    expect(result.structuredContent).toEqual({
      events: [EVENT_B],
      total: 3,
      page: 2,
      pageSize: 2,
      hasMore: false,
    });
    expect(api.calls[0].query).toEqual({
      page: '2',
      pageSize: '2',
      eventName: 'purchase.completed',
      search: 'ada',
      contactEmail: 'ada@example.com',
      dateFrom: '2026-10-01T00:00:00Z',
      dateTo: '2026-10-31T23:59:59Z',
    });
  });

  it('maps an API error to an isError result that names the fix', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/events',
        status: 403,
        body: { error: 'Insufficient permissions', code: 'FORBIDDEN' },
      },
    ]);
    client = await connectTool(registerListEvents, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_events',
      arguments: {},
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
    expect(result.content[0].text).toContain('(code: FORBIDDEN)');
    expect(result.content[0].text).toContain('Ask an organization admin');
    expect(result.structuredContent).toBeUndefined();
  });

  it('refuses without a credential and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerListEvents, makeApiConfig({ api: null }));

    const result = (await client.callTool({
      name: 'list_events',
      arguments: {},
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('is annotated read-only', async () => {
    mockApi([]);
    client = await connectTool(registerListEvents, makeApiConfig());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'list_events');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
