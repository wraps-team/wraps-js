import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGetSegment } from '../../tools/get-segment.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const CONDITION = {
  logic: 'AND',
  groups: [{ filters: [{ field: 'properties.plan', operator: 'equals', value: 'pro' }] }],
};

const SEGMENT = {
  id: 'seg_1',
  name: 'Pro customers',
  description: null,
  condition: CONDITION,
  memberCount: 4,
  trackMembership: false,
  lastComputedAt: '2026-10-03T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
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

describe('get_segment', () => {
  it('returns the single record with its full condition and the request sent', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/segments/seg_1', body: SEGMENT }]);
    client = await connectTool(registerGetSegment, makeApiConfig());

    const result = await client.callTool({ name: 'get_segment', arguments: { id: 'seg_1' } });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(SEGMENT);
    expect(textOf(result)).toContain('Pro customers');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/segments/seg_1');
    expect(api.calls[0].query).toEqual({});
  });

  it('percent-encodes an id that contains a slash', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/segments/a%2Fb', body: SEGMENT }]);
    client = await connectTool(registerGetSegment, makeApiConfig());

    await client.callTool({ name: 'get_segment', arguments: { id: 'a/b' } });

    expect(api.calls[0].path).toBe('/v1/segments/a%2Fb');
  });

  it('maps a 404 to an actionable tool error that names the list tool', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/segments/seg_missing',
        status: 404,
        body: { error: 'Segment not found' },
      },
    ]);
    client = await connectTool(registerGetSegment, makeApiConfig());

    const result = await client.callTool({
      name: 'get_segment',
      arguments: { id: 'seg_missing' },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(textOf(result)).toContain('Not found in this organization');
    expect(textOf(result)).toContain('Segment not found');
    expect(textOf(result)).toContain('list tool');
  });

  it('refuses with the credential fix and sends no request when no API credential is set', async () => {
    const api = mockApi([]);
    client = await connectTool(registerGetSegment, makeApiConfig({ api: null }));

    const result = await client.callTool({ name: 'get_segment', arguments: { id: 'seg_1' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('WRAPS_API_KEY');
    expect(api.calls).toHaveLength(0);
  });
});
