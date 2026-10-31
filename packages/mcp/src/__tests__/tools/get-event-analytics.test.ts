import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGetEventAnalytics } from '../../tools/get-event-analytics.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

const ANALYTICS_7D = {
  totalEvents: 120,
  eventsThisPeriod: 14,
  activeContacts: 5,
  avgEventsPerContact: 2.8,
  dailyEvents: [
    { date: '2026-10-28', count: 0 },
    { date: '2026-10-29', count: 14 },
  ],
  topEventNames: [
    { name: 'purchase.completed', count: 9 },
    { name: 'page.viewed', count: 5 },
  ],
};

describe('get_event_analytics', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('returns pinned analytics with per-row ids and sends days and timezone', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/events/analytics',
        query: { days: '7', timezone: 'America/New_York' },
        body: ANALYTICS_7D,
      },
    ]);
    client = await connectTool(registerGetEventAnalytics, makeApiConfig());

    const result = (await client.callTool({
      name: 'get_event_analytics',
      arguments: { days: 7, timezone: 'America/New_York' },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      totalEvents: 120,
      eventsThisPeriod: 14,
      activeContacts: 5,
      avgEventsPerContact: 2.8,
      dailyEvents: [
        { id: '2026-10-28', date: '2026-10-28', count: 0 },
        { id: '2026-10-29', date: '2026-10-29', count: 14 },
      ],
      topEventNames: [
        { id: 'purchase.completed', name: 'purchase.completed', count: 9 },
        { id: 'page.viewed', name: 'page.viewed', count: 5 },
      ],
    });
    expect(result.content[0].text).toContain('Last 7 days: 14 events');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/events/analytics');
    expect(api.calls[0].query).toEqual({ days: '7', timezone: 'America/New_York' });
  });

  it('omits days and timezone when not given so the API defaults apply', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/events/analytics', body: ANALYTICS_7D }]);
    client = await connectTool(registerGetEventAnalytics, makeApiConfig());

    await client.callTool({ name: 'get_event_analytics', arguments: {} });

    expect(api.calls[0].query).toEqual({});
  });

  it('maps a rejected request to an isError result that names the fix', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/events/analytics',
        status: 429,
        body: { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
      },
    ]);
    client = await connectTool(registerGetEventAnalytics, makeApiConfig());

    const result = (await client.callTool({
      name: 'get_event_analytics',
      arguments: {},
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Rate limited by the Wraps API');
    expect(result.content[0].text).toContain('retry later');
    expect(result.structuredContent).toBeUndefined();
  });

  it('refuses without a credential and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerGetEventAnalytics, makeApiConfig({ api: null }));

    const result = (await client.callTool({
      name: 'get_event_analytics',
      arguments: {},
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('is annotated read-only', async () => {
    mockApi([]);
    client = await connectTool(registerGetEventAnalytics, makeApiConfig());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'get_event_analytics');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
