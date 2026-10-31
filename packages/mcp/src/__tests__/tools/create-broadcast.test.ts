import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCreateBroadcast } from '../../tools/create-broadcast.ts';
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

const DRAFT = {
  id: 'bcs_new',
  status: 'draft',
  name: 'Spring launch',
  channel: 'email',
  totalRecipients: 0,
  processedRecipients: 0,
  sent: 0,
  delivered: 0,
  failed: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  complained: 0,
  suppressed: 0,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-10-29T12:00:00.000Z',
};

const ARGS = {
  name: 'Spring launch',
  subject: 'New in spring',
  from: 'hello@example.com',
  fromName: 'Wraps',
  templateId: 'tpl_1',
  recipientFilter: { audienceType: 'segment', segmentId: 'seg_1' },
  awsAccountId: 'aws_1',
};

describe('create_broadcast', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('creates a draft with the content sent and returns the new id with its zero counts', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/batch/drafts', status: 201, body: DRAFT }]);
    client = await connectTool(registerCreateBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'create_broadcast',
      arguments: ARGS,
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: 'bcs_new',
      status: 'draft',
      name: 'Spring launch',
      channel: 'email',
      totalRecipients: 0,
      processedRecipients: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complained: 0,
      suppressed: 0,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-10-29T12:00:00.000Z',
    });
    expect(result.content[0].text).toContain('Nothing was sent');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/batch/drafts');
    expect(api.calls[0].body).toEqual(ARGS);
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('maps a 404 for a foreign template to an error that names the missing id type', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/batch/drafts',
        status: 404,
        body: { error: 'Template not found' },
      },
    ]);
    client = await connectTool(registerCreateBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'create_broadcast',
      arguments: { templateId: 'tpl_foreign' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not found in this organization');
    expect(result.content[0].text).toContain('Template not found');
    expect(api.calls).toHaveLength(1);
  });

  it('maps a 403 from the plan gate or read-only role to a permission error', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/batch/drafts',
        status: 403,
        body: { error: 'Your plan does not include topic audiences' },
      },
    ]);
    client = await connectTool(registerCreateBroadcast, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'create_broadcast',
      arguments: { recipientFilter: { audienceType: 'topic', topicId: 'top_1' } },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
    expect(result.content[0].text).toContain('does not include topic audiences');
  });

  it('refuses when write is disabled and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(registerCreateBroadcast, makeApiConfig({ writeEnabled: false }));

    const result = (await client.callTool({
      name: 'create_broadcast',
      arguments: { name: 'Spring launch' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
