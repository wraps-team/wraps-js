import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerResumeBroadcast } from '../../tools/resume-broadcast.ts';
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

describe('resume_broadcast', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('resumes from the durable heartbeat when no chunk index is given (no body sent)', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/batch/bcs_failed/resume',
        body: { resumed: true, fromChunkIndex: 3 },
      },
    ]);
    client = await connectTool(registerResumeBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'resume_broadcast',
      arguments: { id: 'bcs_failed', confirm: true },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: 'bcs_failed',
      resumed: true,
      fromChunkIndex: 3,
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/batch/bcs_failed/resume');
    expect(api.calls[0].body).toBeUndefined();
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('passes an explicit fromChunkIndex through as the body', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/batch/bcs_failed/resume',
        body: { resumed: true, fromChunkIndex: 0 },
      },
    ]);
    client = await connectTool(registerResumeBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'resume_broadcast',
      arguments: { id: 'bcs_failed', fromChunkIndex: 0, confirm: true },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ fromChunkIndex: 0 });
    expect(api.calls[0].body).toEqual({ fromChunkIndex: 0 });
  });

  it('maps a 409 (not processing or failed) to an actionable tool error', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/batch/bcs_done/resume',
        status: 409,
        body: {
          error:
            "Cannot resume batch in 'completed' status. Only 'processing' or 'failed' batches can be resumed.",
        },
      },
    ]);
    client = await connectTool(registerResumeBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'resume_broadcast',
      arguments: { id: 'bcs_done', confirm: true },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Conflict');
    expect(result.content[0].text).toContain("Only 'processing' or 'failed'");
    expect(api.calls).toHaveLength(1);
  });

  it('refuses without confirm and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerResumeBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'resume_broadcast',
      arguments: { id: 'bcs_failed' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('confirm must be true');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses with confirm true when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerResumeBroadcast, makeApiConfig({ writeEnabled: false }));

    const result = (await client.callTool({
      name: 'resume_broadcast',
      arguments: { id: 'bcs_failed', confirm: true },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
