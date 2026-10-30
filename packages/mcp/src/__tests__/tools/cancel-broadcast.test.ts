import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCancelBroadcast } from '../../tools/cancel-broadcast.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('cancel_broadcast', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('calls DELETE on the broadcast and reports it cancelled', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: '/v1/batch/bcs_queued',
        body: { success: true, id: 'bcs_queued', status: 'cancelled' },
      },
    ]);
    client = await connectTool(registerCancelBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'cancel_broadcast',
      arguments: { id: 'bcs_queued', confirm: true },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: 'bcs_queued',
      success: true,
      status: 'cancelled',
    });
    expect(result.content[0].text).toContain('Cancelled broadcast bcs_queued');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('DELETE');
    expect(api.calls[0].path).toBe('/v1/batch/bcs_queued');
    expect(api.calls[0].body).toBeUndefined();
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('maps a 400 (completed broadcast cannot be cancelled) to an actionable tool error', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: '/v1/batch/bcs_done',
        status: 400,
        body: {
          error:
            "Cannot cancel batch in 'completed' status. Only scheduled, queued, or processing batches can be cancelled.",
        },
      },
    ]);
    client = await connectTool(registerCancelBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'cancel_broadcast',
      arguments: { id: 'bcs_done', confirm: true },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('rejected the request');
    expect(result.content[0].text).toContain('Only scheduled, queued, or processing');
    expect(api.calls).toHaveLength(1);
  });

  it('refuses without confirm and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerCancelBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'cancel_broadcast',
      arguments: { id: 'bcs_queued' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('confirm must be true');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses with confirm true when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerCancelBroadcast, makeApiConfig({ writeEnabled: false }));

    const result = (await client.callTool({
      name: 'cancel_broadcast',
      arguments: { id: 'bcs_queued', confirm: true },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
