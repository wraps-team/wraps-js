import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerUpdateSegment } from '../../tools/update-segment.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const CONDITION = {
  logic: 'OR',
  groups: [{ filters: [{ field: 'status', operator: 'equals', value: 'active' }] }],
};

const UPDATED = {
  id: 'seg_1',
  name: 'Renamed',
  description: null,
  condition: CONDITION,
  memberCount: 7,
  trackMembership: false,
  lastComputedAt: '2026-10-04T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
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

describe('update_segment', () => {
  it('sends only the fields passed and returns the updated single record', async () => {
    const api = mockApi([{ method: 'PATCH', path: '/v1/segments/seg_1', body: UPDATED }]);
    client = await connectTool(registerUpdateSegment, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_segment',
      arguments: { id: 'seg_1', name: 'Renamed', condition: CONDITION },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(UPDATED);
    expect(textOf(result)).toContain('Renamed');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('PATCH');
    expect(api.calls[0].path).toBe('/v1/segments/seg_1');
    expect(api.calls[0].query).toEqual({});
    expect(api.calls[0].body).toEqual({ name: 'Renamed', condition: CONDITION });
  });

  it('sends an empty description to clear it', async () => {
    const api = mockApi([{ method: 'PATCH', path: '/v1/segments/seg_1', body: UPDATED }]);
    client = await connectTool(registerUpdateSegment, makeApiConfig({ writeEnabled: true }));

    await client.callTool({
      name: 'update_segment',
      arguments: { id: 'seg_1', description: '' },
    });

    expect(api.calls[0].body).toEqual({ description: '' });
  });

  it('percent-encodes an id that contains a slash', async () => {
    const api = mockApi([{ method: 'PATCH', path: '/v1/segments/a%2Fb', body: UPDATED }]);
    client = await connectTool(registerUpdateSegment, makeApiConfig({ writeEnabled: true }));

    await client.callTool({ name: 'update_segment', arguments: { id: 'a/b', name: 'X' } });

    expect(api.calls[0].path).toBe('/v1/segments/a%2Fb');
  });

  it('refuses when write is disabled and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerUpdateSegment, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({
      name: 'update_segment',
      arguments: { id: 'seg_1', name: 'Renamed' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });

  it('maps an API 404 to an actionable tool error and names the list tool', async () => {
    const api = mockApi([
      {
        method: 'PATCH',
        path: '/v1/segments/seg_missing',
        status: 404,
        body: { error: 'Segment not found' },
      },
    ]);
    client = await connectTool(registerUpdateSegment, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_segment',
      arguments: { id: 'seg_missing', name: 'X' },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(textOf(result)).toContain('Not found in this organization');
    expect(textOf(result)).toContain('list tool');
  });

  it('refuses with the credential fix and sends no request when no API credential is set', async () => {
    const api = mockApi([]);
    client = await connectTool(
      registerUpdateSegment,
      makeApiConfig({ writeEnabled: true, api: null })
    );

    const result = await client.callTool({
      name: 'update_segment',
      arguments: { id: 'seg_1', name: 'X' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('WRAPS_API_KEY');
    expect(api.calls).toHaveLength(0);
  });
});
