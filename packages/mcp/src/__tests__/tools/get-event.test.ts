import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGetEvent } from '../../tools/get-event.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

const EVENT = {
  id: 'evt_1',
  eventName: 'purchase.completed',
  eventData: { amount: 4200, currency: 'usd' },
  createdAt: '2026-10-01T10:00:00.000Z',
  contactId: 'ctc_1',
  contactEmail: 'ada@example.com',
  contactFirstName: 'Ada',
  contactLastName: 'Lovelace',
};

describe('get_event', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('returns the single record with pinned structuredContent and the encoded path', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/events/evt%2F1',
        body: EVENT,
      },
    ]);
    client = await connectTool(registerGetEvent, makeApiConfig());

    const result = (await client.callTool({
      name: 'get_event',
      arguments: { id: 'evt/1' },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(EVENT);
    expect(result.content[0].text).toContain('purchase.completed');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/events/evt%2F1');
    expect(api.calls[0].query).toEqual({});
  });

  it('maps a 404 to an isError result that says the event is not in this organization', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/events/evt_missing',
        status: 404,
        body: { error: 'Event not found' },
      },
    ]);
    client = await connectTool(registerGetEvent, makeApiConfig());

    const result = (await client.callTool({
      name: 'get_event',
      arguments: { id: 'evt_missing' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not found in this organization');
    expect(result.content[0].text).toContain('Event not found');
    expect(result.content[0].text).toContain('Check the id with the matching list tool');
    expect(result.structuredContent).toBeUndefined();
  });

  it('refuses without a credential and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerGetEvent, makeApiConfig({ api: null }));

    const result = (await client.callTool({
      name: 'get_event',
      arguments: { id: 'evt_1' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('is annotated read-only', async () => {
    mockApi([]);
    client = await connectTool(registerGetEvent, makeApiConfig());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'get_event');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
