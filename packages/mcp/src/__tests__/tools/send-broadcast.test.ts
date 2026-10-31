import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerSendBroadcast } from '../../tools/send-broadcast.ts';
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

describe('send_broadcast', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('sends the draft now with the body the route expects and returns the queued status', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/batch/bcs_draft/send',
        status: 201,
        body: { id: 'bcs_draft', status: 'queued' },
      },
    ]);
    client = await connectTool(registerSendBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'send_broadcast',
      arguments: { id: 'bcs_draft', awsAccountId: 'aws_1', totalRecipients: 120, confirm: true },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ id: 'bcs_draft', status: 'queued' });
    expect(result.content[0].text).toContain('is queued');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/batch/bcs_draft/send');
    expect(api.calls[0].body).toEqual({ awsAccountId: 'aws_1', totalRecipients: 120 });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('passes scheduledFor through and surfaces the API warning when no scheduler is configured', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/batch/bcs_draft/send',
        status: 201,
        body: {
          id: 'bcs_draft',
          status: 'scheduled',
          warning:
            'Scheduling is not configured in this environment, so this broadcast will not send automatically.',
        },
      },
    ]);
    client = await connectTool(registerSendBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'send_broadcast',
      arguments: {
        id: 'bcs_draft',
        awsAccountId: 'aws_1',
        totalRecipients: 5,
        scheduledFor: '2099-01-01T09:00:00.000Z',
        confirm: true,
      },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ status: 'scheduled' });
    expect(result.structuredContent?.warning).toContain('will not send automatically');
    expect(api.calls[0].body).toEqual({
      awsAccountId: 'aws_1',
      totalRecipients: 5,
      scheduledFor: '2099-01-01T09:00:00.000Z',
    });
  });

  it('maps a 400 (not a draft) to an actionable tool error', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/batch/bcs_sent/send',
        status: 400,
        body: { error: "Cannot promote batch in 'completed' status. Only drafts can be promoted." },
      },
    ]);
    client = await connectTool(registerSendBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'send_broadcast',
      arguments: { id: 'bcs_sent', awsAccountId: 'aws_1', totalRecipients: 1, confirm: true },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('rejected the request');
    expect(result.content[0].text).toContain('Only drafts can be promoted');
    expect(api.calls).toHaveLength(1);
  });

  it('refuses without confirm and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerSendBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'send_broadcast',
      arguments: { id: 'bcs_draft', awsAccountId: 'aws_1', totalRecipients: 1 },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('confirm must be true');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses with confirm true when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerSendBroadcast, makeApiConfig({ writeEnabled: false }));

    const result = (await client.callTool({
      name: 'send_broadcast',
      arguments: { id: 'bcs_draft', awsAccountId: 'aws_1', totalRecipients: 1, confirm: true },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
