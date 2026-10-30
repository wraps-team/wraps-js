import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerListSegments } from '../../tools/list-segments.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const SEGMENT_A = {
  id: 'seg_1',
  name: 'Pro customers',
  description: null,
  memberCount: 4,
  trackMembership: false,
  lastComputedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

const SEGMENT_B = {
  ...SEGMENT_A,
  id: 'seg_2',
  name: 'Trial users',
  description: 'Signed up in the last 30 days',
  memberCount: 9,
  lastComputedAt: '2026-10-03T00:00:00.000Z',
};

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

function textOf(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('list_segments', () => {
  it('lists one page with the API body pinned and the request sent as expected', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/segments',
        query: { limit: '2' },
        body: { segments: [SEGMENT_A, SEGMENT_B], total: 3, limit: 2, offset: 0 },
      },
    ]);
    client = await connectTool(registerListSegments, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({ name: 'list_segments', arguments: { limit: 2 } });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      segments: [SEGMENT_A, SEGMENT_B],
      total: 3,
      limit: 2,
      offset: 0,
      hasMore: true,
      nextOffset: 2,
    });
    expect(textOf(result)).toContain('Showing segments 1-2 of 3');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/segments');
    expect(api.calls[0].query).toEqual({ limit: '2' });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('continues pagination from nextOffset and passes search through', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/segments',
        query: { limit: '2', search: 'trial' },
        body: { segments: [SEGMENT_A, SEGMENT_B], total: 3, limit: 2, offset: 0 },
      },
      {
        method: 'GET',
        path: '/v1/segments',
        query: { limit: '2', offset: '2', search: 'trial' },
        body: {
          segments: [{ ...SEGMENT_A, id: 'seg_3', name: 'Last one' }],
          total: 3,
          limit: 2,
          offset: 2,
        },
      },
    ]);
    client = await connectTool(registerListSegments, makeApiConfig());

    const first = await client.callTool({
      name: 'list_segments',
      arguments: { limit: 2, search: 'trial' },
    });
    expect(first.structuredContent).toMatchObject({ hasMore: true, nextOffset: 2 });

    const second = await client.callTool({
      name: 'list_segments',
      arguments: { limit: 2, offset: 2, search: 'trial' },
    });
    expect(second.structuredContent).toEqual({
      segments: [{ ...SEGMENT_A, id: 'seg_3', name: 'Last one' }],
      total: 3,
      limit: 2,
      offset: 2,
      hasMore: false,
      nextOffset: null,
    });
    expect(textOf(second)).toContain('This is the last page');
    expect(api.calls.map((c) => c.query.offset)).toEqual([undefined, '2']);
    expect(api.calls[1].query.search).toBe('trial');
  });

  it('maps an API plan refusal to an actionable tool error', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/segments',
        status: 403,
        body: { error: 'Segments require a Pro plan', code: 'PLAN_REQUIRED' },
      },
    ]);
    client = await connectTool(registerListSegments, makeApiConfig());

    const result = await client.callTool({ name: 'list_segments', arguments: {} });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(textOf(result)).toContain('Segments require a Pro plan');
    expect(textOf(result)).toContain('check your plan');
    expect(textOf(result)).not.toContain('test-token-not-real');
  });

  it('refuses with the credential fix and sends no request when no API credential is set', async () => {
    const api = mockApi([]);
    client = await connectTool(registerListSegments, makeApiConfig({ api: null }));

    const result = await client.callTool({ name: 'list_segments', arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('WRAPS_API_KEY');
    expect(api.calls).toHaveLength(0);
  });

  it('rejects a limit above the route maximum before any request is sent', async () => {
    const api = mockApi([]);
    client = await connectTool(registerListSegments, makeApiConfig());

    const result = await client.callTool({ name: 'list_segments', arguments: { limit: 101 } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('limit');
    expect(api.calls).toHaveLength(0);
  });
});
