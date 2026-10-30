import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerDeleteSegment } from '../../tools/delete-segment.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

function textOf(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('delete_segment', () => {
  it('deletes the segment with confirm: true and returns the deleted id', async () => {
    const api = mockApi([
      { method: 'DELETE', path: '/v1/segments/seg_1', body: { success: true } },
    ]);
    client = await connectTool(registerDeleteSegment, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_segment',
      arguments: { id: 'seg_1', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ id: 'seg_1', deleted: true });
    expect(textOf(result)).toContain('seg_1');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('DELETE');
    expect(api.calls[0].path).toBe('/v1/segments/seg_1');
    // The route takes no confirm query; confirm stays an MCP-level gate.
    expect(api.calls[0].query).toEqual({});
  });

  it('refuses without confirm and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerDeleteSegment, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_segment',
      arguments: { id: 'seg_1' } as unknown as { id: string; confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm must be true');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses confirm: false and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerDeleteSegment, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_segment',
      arguments: { id: 'seg_1', confirm: false } as unknown as { id: string; confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('refuses when write is disabled, even with confirm: true, and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerDeleteSegment, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({
      name: 'delete_segment',
      arguments: { id: 'seg_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });

  it('maps a 409 from a live broadcast to an actionable error that keeps the API reason', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: '/v1/segments/seg_1',
        status: 409,
        body: {
          error:
            'This segment is targeted by a scheduled, queued, or in-progress broadcast. Cancel or wait for it to finish before deleting the segment.',
        },
      },
    ]);
    client = await connectTool(registerDeleteSegment, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_segment',
      arguments: { id: 'seg_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(textOf(result)).toContain('Cancel or wait for it to finish');
    expect(textOf(result)).toContain('Read it again, then retry');
  });

  it('refuses with the credential fix and sends no request when no API credential is set', async () => {
    const api = mockApi([]);
    client = await connectTool(
      registerDeleteSegment,
      makeApiConfig({ writeEnabled: true, api: null })
    );

    const result = await client.callTool({
      name: 'delete_segment',
      arguments: { id: 'seg_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('WRAPS_API_KEY');
    expect(api.calls).toHaveLength(0);
  });
});
