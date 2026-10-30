import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerDuplicateBroadcast } from '../../tools/duplicate-broadcast.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

describe('duplicate_broadcast', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('copies a completed broadcast into a new draft and returns the new id', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/batch/bcs_sent/duplicate',
        body: { id: 'bcs_copy', status: 'draft', name: 'October digest (copy)' },
      },
    ]);
    client = await connectTool(registerDuplicateBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'duplicate_broadcast',
      arguments: { id: 'bcs_sent' },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: 'bcs_copy',
      status: 'draft',
      name: 'October digest (copy)',
    });
    expect(result.content[0].text).toContain('Nothing was sent');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/batch/bcs_sent/duplicate');
    expect(api.calls[0].body).toBeUndefined();
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('maps a 403 (no broadcasts write permission) to an actionable tool error', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/batch/bcs_sent/duplicate',
        status: 403,
        body: { error: 'Missing permission: broadcasts:write' },
      },
    ]);
    client = await connectTool(registerDuplicateBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'duplicate_broadcast',
      arguments: { id: 'bcs_sent' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
    expect(result.content[0].text).toContain('Missing permission: broadcasts:write');
    expect(api.calls).toHaveLength(1);
  });

  it('refuses when write is disabled and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerDuplicateBroadcast, makeApiConfig({ writeEnabled: false }));

    const result = (await client.callTool({
      name: 'duplicate_broadcast',
      arguments: { id: 'bcs_sent' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
