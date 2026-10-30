import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerPreviewSegment } from '../../tools/preview-segment.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const CONDITION = {
  logic: 'AND',
  groups: [{ filters: [{ field: 'properties.plan', operator: 'equals', value: 'pro' }] }],
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

describe('preview_segment', () => {
  it('returns the full count and a truncated sample, with the condition and limit sent', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/segments/preview',
        body: { count: 9, sample: ['a@example.com', 'b@example.com', 'c@example.com'] },
      },
    ]);
    client = await connectTool(registerPreviewSegment, makeApiConfig());

    const result = await client.callTool({
      name: 'preview_segment',
      arguments: { condition: CONDITION, limit: 3 },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      id: null,
      count: 9,
      sample: ['a@example.com', 'b@example.com', 'c@example.com'],
      sampleTruncated: true,
    });
    expect(textOf(result)).toContain('reaches 9 sendable contact(s)');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/segments/preview');
    expect(api.calls[0].body).toEqual({ condition: CONDITION, limit: 3 });
  });

  it('reports an untruncated sample when every match fits in the sample', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/segments/preview',
        body: { count: 1, sample: ['only@example.com'] },
      },
    ]);
    client = await connectTool(registerPreviewSegment, makeApiConfig());

    const result = await client.callTool({
      name: 'preview_segment',
      arguments: { condition: CONDITION },
    });

    expect(result.structuredContent).toMatchObject({ count: 1, sampleTruncated: false });
  });

  it('passes the limit through unchanged so a later call can ask for more samples', async () => {
    const api = mockApi([
      { method: 'POST', path: '/v1/segments/preview', body: { count: 0, sample: [] } },
      { method: 'POST', path: '/v1/segments/preview', body: { count: 0, sample: [] } },
    ]);
    client = await connectTool(registerPreviewSegment, makeApiConfig());

    await client.callTool({ name: 'preview_segment', arguments: { condition: CONDITION } });
    await client.callTool({
      name: 'preview_segment',
      arguments: { condition: CONDITION, limit: 100 },
    });

    expect(api.calls[0].body).toEqual({ condition: CONDITION });
    expect(api.calls[1].body).toEqual({ condition: CONDITION, limit: 100 });
  });

  it('maps an API 400 for an incomplete filter to a fix-the-arguments error', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/segments/preview',
        status: 400,
        body: { error: 'Filter value is required' },
      },
    ]);
    client = await connectTool(registerPreviewSegment, makeApiConfig());

    const result = await client.callTool({
      name: 'preview_segment',
      arguments: {
        condition: {
          logic: 'AND',
          groups: [{ filters: [{ field: 'properties.plan', operator: 'equals' }] }],
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(textOf(result)).toContain('Filter value is required');
    expect(textOf(result)).toContain('Fix the arguments');
  });

  it('refuses with the credential fix and sends no request when no API credential is set', async () => {
    const api = mockApi([]);
    client = await connectTool(registerPreviewSegment, makeApiConfig({ api: null }));

    const result = await client.callTool({
      name: 'preview_segment',
      arguments: { condition: CONDITION },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('WRAPS_API_KEY');
    expect(api.calls).toHaveLength(0);
  });
});
