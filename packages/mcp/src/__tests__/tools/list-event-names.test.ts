import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerListEventNames } from '../../tools/list-event-names.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

describe('list_event_names', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('returns every name with pinned structuredContent from one unfiltered request', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/events/names',
        body: { eventNames: ['page.viewed', 'purchase.completed'] },
      },
    ]);
    client = await connectTool(registerListEventNames, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_event_names',
      arguments: {},
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      total: 2,
      names: [
        { id: 'page.viewed', name: 'page.viewed' },
        { id: 'purchase.completed', name: 'purchase.completed' },
      ],
    });
    expect(result.content[0].text).toContain('2 distinct event names');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/events/names');
    expect(api.calls[0].query).toEqual({});
  });

  it('returns an empty list with a plain message when no names exist', async () => {
    mockApi([{ method: 'GET', path: '/v1/events/names', body: { eventNames: [] } }]);
    client = await connectTool(registerListEventNames, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_event_names',
      arguments: {},
    })) as ToolResult;

    expect(result.structuredContent).toEqual({ total: 0, names: [] });
    expect(result.content[0].text).toContain('No custom event names');
  });

  it('maps an API error to an isError result that names the fix', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/events/names',
        status: 401,
        body: { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      },
    ]);
    client = await connectTool(registerListEventNames, makeApiConfig());

    const result = (await client.callTool({
      name: 'list_event_names',
      arguments: {},
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Check that WRAPS_API_KEY is current');
    expect(result.structuredContent).toBeUndefined();
  });

  it('refuses without a credential and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerListEventNames, makeApiConfig({ api: null }));

    const result = (await client.callTool({
      name: 'list_event_names',
      arguments: {},
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('is annotated read-only', async () => {
    mockApi([]);
    client = await connectTool(registerListEventNames, makeApiConfig());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'list_event_names');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
