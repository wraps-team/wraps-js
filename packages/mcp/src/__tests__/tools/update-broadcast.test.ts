import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerUpdateBroadcast } from '../../tools/update-broadcast.ts';
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

describe('update_broadcast', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('edits a scheduled broadcast, sending only the fields passed, and returns the id, status and send time', async () => {
    const api = mockApi([
      {
        method: 'PATCH',
        path: '/v1/batch/bcs_sched',
        body: { id: 'bcs_sched', status: 'scheduled', scheduledFor: '2099-01-01T09:00:00.000Z' },
      },
    ]);
    client = await connectTool(registerUpdateBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'update_broadcast',
      arguments: { id: 'bcs_sched', from: 'hello@example.com', previewText: null },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: 'bcs_sched',
      status: 'scheduled',
      scheduledFor: '2099-01-01T09:00:00.000Z',
    });
    expect(result.content[0].text).toContain('Nothing was sent');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('PATCH');
    expect(api.calls[0].path).toBe('/v1/batch/bcs_sched');
    expect(api.calls[0].body).toEqual({ from: 'hello@example.com', previewText: null });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('reschedules: sends the new scheduledFor and surfaces a warning when no scheduler is configured', async () => {
    const api = mockApi([
      {
        method: 'PATCH',
        path: '/v1/batch/bcs_sched',
        body: {
          id: 'bcs_sched',
          status: 'scheduled',
          scheduledFor: '2099-02-01T10:00:00.000Z',
          warning:
            'Scheduling is not configured in this environment, so this broadcast will not send automatically.',
        },
      },
    ]);
    client = await connectTool(registerUpdateBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'update_broadcast',
      arguments: { id: 'bcs_sched', scheduledFor: '2099-02-01T10:00:00.000Z' },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ scheduledFor: '2099-02-01T10:00:00.000Z' });
    expect(result.structuredContent?.warning).toContain('will not send automatically');
    expect(api.calls[0].body).toEqual({ scheduledFor: '2099-02-01T10:00:00.000Z' });
  });

  it('maps a 400 (not a scheduled broadcast, e.g. a draft) to an error that names the status and the rule', async () => {
    const api = mockApi([
      {
        method: 'PATCH',
        path: '/v1/batch/bcs_draft',
        status: 400,
        body: {
          error:
            "Cannot edit batch in 'draft' status. Only scheduled batches can be edited; edit a draft from the dashboard.",
        },
      },
    ]);
    client = await connectTool(registerUpdateBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'update_broadcast',
      arguments: { id: 'bcs_draft', name: 'Renamed' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Cannot edit batch in 'draft' status");
    expect(result.content[0].text).toContain('Only scheduled batches can be edited');
    expect(api.calls).toHaveLength(1);
  });

  it('maps a 409 (inside the cutoff or already sending) to a conflict error that says to cancel', async () => {
    const api = mockApi([
      {
        method: 'PATCH',
        path: '/v1/batch/bcs_soon',
        status: 409,
        body: {
          error:
            'This broadcast is about to start sending and can no longer be edited. Cancel it instead.',
        },
      },
    ]);
    client = await connectTool(registerUpdateBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'update_broadcast',
      arguments: { id: 'bcs_soon', name: 'Renamed' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Conflict');
    expect(result.content[0].text).toContain('Cancel it instead');
    expect(api.calls).toHaveLength(1);
  });

  it('refuses when write is disabled and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerUpdateBroadcast, makeApiConfig({ writeEnabled: false }));

    const result = (await client.callTool({
      name: 'update_broadcast',
      arguments: { id: 'bcs_sched', name: 'Renamed' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
