import { describe, expect, it } from 'vitest';
import { registerKillAgent } from '../../tools/kill-agent.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const KILLED_AGENT = {
  id: 'agent_1',
  organizationId: 'org_1',
  name: 'Support bot',
  emailAddress: 'support@example.com',
  domain: 'example.com',
  status: 'KILLED',
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
  updatedAt: '2026-10-31T00:00:00.000Z',
};

describe('kill_agent', () => {
  it('refuses without WRAPS_WRITE_ENABLED and makes no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerKillAgent, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({
      name: 'kill_agent',
      arguments: { id: 'agent_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('refuses without confirm and makes no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerKillAgent, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'kill_agent',
      arguments: { id: 'agent_1' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/confirm must be true/);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('kills the agent with a POST to its kill route and reports it as killed', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/agents/agent_1/kill',
        body: { agent: KILLED_AGENT, syncStatus: 'skipped' },
      },
    ]);
    const client = await connectTool(registerKillAgent, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'kill_agent',
      arguments: { id: 'agent_1', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Killed agent Support bot (agent_1)');
    expect(text(result)).not.toContain('INCOMPLETE');
    expect(result.structuredContent).toEqual({
      id: 'agent_1',
      name: 'Support bot',
      status: 'KILLED',
      syncStatus: 'skipped',
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'POST', path: '/v1/agents/agent_1/kill' });
    await client.close();
  });

  it('surfaces a failed enforcer sync as a non-success line, not as Killed', async () => {
    const warning =
      'Kill applied in Wraps, but syncing it to the enforcer failed — the agent may keep sending until the sync succeeds. Lambda timed out.';
    mockApi([
      {
        method: 'POST',
        path: '/v1/agents/agent_1/kill',
        body: { agent: KILLED_AGENT, syncStatus: 'failed', warning },
      },
    ]);
    const client = await connectTool(registerKillAgent, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'kill_agent',
      arguments: { id: 'agent_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Kill INCOMPLETE/);
    expect(text(result)).not.toMatch(/^Killed/);
    expect(text(result)).toContain(warning);
    expect(text(result)).toContain('may still send');
    expect(result.structuredContent).toMatchObject({ syncStatus: 'failed', warning });
    await client.close();
  });
});
