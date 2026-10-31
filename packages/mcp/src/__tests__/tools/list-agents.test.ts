import { describe, expect, it } from 'vitest';
import { registerListAgents } from '../../tools/list-agents.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const AGENT_ACTIVE = {
  id: 'agent_1',
  organizationId: 'org_1',
  name: 'Support bot',
  emailAddress: 'support@example.com',
  domain: 'example.com',
  status: 'ACTIVE',
  policy: {
    maxPerHour: 20,
    maxPerDay: 100,
    allowedRecipients: [],
    allowedRecipientDomains: [],
  },
  credentialUserArn: null,
  enforcerFunctionArn: null,
  awsAccountId: null,
  createdBy: 'user_1',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const AGENT_KILLED = { ...AGENT_ACTIVE, id: 'agent_2', name: 'Old bot', status: 'KILLED' };

describe('list_agents', () => {
  it('lists the organization agents with a GET and returns them as structured content', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/agents',
        body: { agents: [AGENT_ACTIVE, AGENT_KILLED] },
      },
    ]);
    const client = await connectTool(registerListAgents, makeApiConfig());

    const result = await client.callTool({ name: 'list_agents', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe('Found 2 agents (1 killed).');
    expect(result.structuredContent).toEqual({ agents: [AGENT_ACTIVE, AGENT_KILLED] });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/v1/agents' });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    await client.close();
  });

  it('is read-only and needs no write mode', async () => {
    mockApi([{ method: 'GET', path: '/v1/agents', body: { agents: [] } }]);
    const client = await connectTool(registerListAgents, makeApiConfig({ writeEnabled: false }));

    const { tools } = await client.listTools();
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true });
    const result = await client.callTool({ name: 'list_agents', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe('Found 0 agents.');
    await client.close();
  });
});
