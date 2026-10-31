import { describe, expect, it } from 'vitest';
import { registerListAgentApprovals } from '../../tools/list-agent-approvals.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const PENDING = {
  id: 'appr_1',
  organizationId: 'org_1',
  agentId: 'agent_1',
  payload: {
    from: 'support@example.com',
    to: 'customer@example.com',
    subject: 'Your refund',
    text: 'Refund issued.',
  },
  reason: 'Recipient is outside the allowlist',
  status: 'PENDING',
  decidedBy: null,
  decidedAt: null,
  messageId: null,
  errorMessage: null,
  createdAt: '2026-10-28T10:00:00.000Z',
  updatedAt: '2026-10-28T10:00:00.000Z',
};

const SENT = {
  ...PENDING,
  id: 'appr_2',
  status: 'SENT',
  decidedBy: 'user_1',
  decidedAt: '2026-10-27T09:00:00.000Z',
  messageId: 'ses-msg-1',
  createdAt: '2026-10-27T08:00:00.000Z',
  updatedAt: '2026-10-27T09:00:00.000Z',
};

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('list_agent_approvals', () => {
  it('lists the whole queue newest first with no query, and pins the request sent', async () => {
    const api = mockApi([
      { method: 'GET', path: '/v1/agents/approvals', body: { approvals: [PENDING, SENT] } },
    ]);
    const client = await connectTool(registerListAgentApprovals, makeApiConfig());

    const result = await client.callTool({ name: 'list_agent_approvals', arguments: {} });

    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as { approvals: Array<Record<string, unknown>> };
    expect(data.approvals).toHaveLength(2);
    expect(data.approvals[0]).toMatchObject({
      id: 'appr_1',
      agentId: 'agent_1',
      status: 'PENDING',
      payload: { to: 'customer@example.com', subject: 'Your refund' },
    });
    expect(data.approvals[1]).toMatchObject({
      id: 'appr_2',
      status: 'SENT',
      messageId: 'ses-msg-1',
    });
    expect(text(result)).toContain('Found 2 approvals');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/v1/agents/approvals', query: {} });
    expect(api.calls[0].query).not.toHaveProperty('cursor');
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    await client.close();
  });

  it('passes status=PENDING through as the only filter', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/agents/approvals',
        query: { status: 'PENDING' },
        body: { approvals: [PENDING] },
      },
    ]);
    const client = await connectTool(registerListAgentApprovals, makeApiConfig());

    const result = await client.callTool({
      name: 'list_agent_approvals',
      arguments: { status: 'PENDING' },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].query).toEqual({ status: 'PENDING' });
    expect(text(result)).toContain('with status PENDING');
    await client.close();
  });

  it('maps a rejected WRAPS_API_KEY (401) to a tool error that names the env var', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/agents/approvals',
        status: 401,
        body: { error: 'Invalid API key', code: 'UNAUTHORIZED' },
      },
    ]);
    const client = await connectTool(registerListAgentApprovals, makeApiConfig());

    const result = await client.callTool({ name: 'list_agent_approvals', arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_API_KEY');
    expect(text(result)).toContain('UNAUTHORIZED');
    await client.close();
  });

  it('refuses without sending a request when no Wraps credential is configured', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerListAgentApprovals, makeApiConfig({ api: null }));

    const result = await client.callTool({ name: 'list_agent_approvals', arguments: {} });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('is read-only and says there is no pagination or truncation', async () => {
    const client = await connectTool(registerListAgentApprovals, makeApiConfig());

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'list_agent_approvals');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(tool?.description).toMatch(/Pagination: none/);
    expect(tool?.description).toMatch(/hasMore/);
    await client.close();
  });
});
