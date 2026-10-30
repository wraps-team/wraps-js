import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCreateSegment } from '../../tools/create-segment.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const CONDITION = {
  logic: 'AND',
  groups: [{ filters: [{ field: 'properties.plan', operator: 'equals', value: 'pro' }] }],
};

const CREATED = {
  id: 'seg_new',
  name: 'Pro customers',
  description: 'Paying plan',
  condition: CONDITION,
  memberCount: 4,
  trackMembership: true,
  lastComputedAt: '2026-10-03T00:00:00.000Z',
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
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

const ARGS = {
  name: 'Pro customers',
  description: 'Paying plan',
  condition: CONDITION,
  trackMembership: true,
};

describe('create_segment', () => {
  it('creates the segment with the body sent and returns the single record', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/segments', status: 201, body: CREATED }]);
    client = await connectTool(registerCreateSegment, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({ name: 'create_segment', arguments: ARGS });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(CREATED);
    expect(textOf(result)).toContain('seg_new');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/segments');
    expect(api.calls[0].query).toEqual({});
    expect(api.calls[0].body).toEqual(ARGS);
  });

  it('refuses when write is disabled and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerCreateSegment, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({ name: 'create_segment', arguments: ARGS });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });

  it('maps an API 400 for an invalid condition to a fix-the-arguments error', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/segments',
        status: 400,
        body: { error: 'Filter operator is required' },
      },
    ]);
    client = await connectTool(registerCreateSegment, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'create_segment',
      arguments: { name: 'Broken', condition: { logic: 'AND', groups: [{ filters: [] }] } },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(textOf(result)).toContain('Filter operator is required');
    expect(textOf(result)).toContain('Fix the arguments');
  });

  it('refuses with the credential fix and sends no request when no API credential is set', async () => {
    const api = mockApi([]);
    client = await connectTool(
      registerCreateSegment,
      makeApiConfig({ writeEnabled: true, api: null })
    );

    const result = await client.callTool({ name: 'create_segment', arguments: ARGS });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('WRAPS_API_KEY');
    expect(api.calls).toHaveLength(0);
  });
});
