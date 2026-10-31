import { describe, expect, it } from 'vitest';
import { registerSetAgentPolicy } from '../../tools/set-agent-policy.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const POLICY = {
  maxPerHour: 5,
  maxPerDay: 50,
  allowedRecipients: ['vip@example.com'],
  allowedRecipientDomains: ['partner.example'],
};

const UPDATED_AGENT = {
  id: 'agent_1',
  organizationId: 'org_1',
  name: 'Support bot',
  emailAddress: 'support@example.com',
  domain: 'example.com',
  status: 'ACTIVE',
  policy: POLICY,
  credentialUserArn: null,
  enforcerFunctionArn: null,
  awsAccountId: null,
  createdBy: 'user_1',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
};

describe('set_agent_policy', () => {
  it('refuses without confirm and makes no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerSetAgentPolicy, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'set_agent_policy',
      arguments: { id: 'agent_1', policy: POLICY },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/confirm must be true/);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('replaces the policy with a PATCH whose body carries all four fields', async () => {
    const api = mockApi([
      {
        method: 'PATCH',
        path: '/v1/agents/agent_1/policy',
        body: { agent: UPDATED_AGENT, syncStatus: 'skipped' },
      },
    ]);
    const client = await connectTool(registerSetAgentPolicy, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'set_agent_policy',
      arguments: { id: 'agent_1', policy: POLICY, confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Replaced the send policy of agent Support bot (agent_1)');
    expect(text(result)).toContain('The previous policy is gone.');
    expect(result.structuredContent).toEqual({
      id: 'agent_1',
      name: 'Support bot',
      status: 'ACTIVE',
      policy: POLICY,
      syncStatus: 'skipped',
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'PATCH',
      path: '/v1/agents/agent_1/policy',
      body: POLICY,
    });
    await client.close();
  });

  it('surfaces a 409 from a killed agent as a tool error', async () => {
    mockApi([
      {
        method: 'PATCH',
        path: '/v1/agents/agent_1/policy',
        status: 409,
        body: { error: 'Agent is killed — its policy can no longer be changed', code: 'CONFLICT' },
      },
    ]);
    const client = await connectTool(registerSetAgentPolicy, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'set_agent_policy',
      arguments: { id: 'agent_1', policy: POLICY, confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Conflict (code: CONFLICT)');
    expect(text(result)).toContain('Agent is killed');
    await client.close();
  });

  it('surfaces a 422 for a partial policy as a tool error that names the fix', async () => {
    mockApi([
      {
        method: 'PATCH',
        path: '/v1/agents/agent_1/policy',
        status: 422,
        body: {
          error: 'Expected required property allowedRecipientDomains',
          code: 'VALIDATION_ERROR',
        },
      },
    ]);
    const client = await connectTool(registerSetAgentPolicy, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'set_agent_policy',
      arguments: {
        id: 'agent_1',
        policy: {
          maxPerHour: 5,
          maxPerDay: 50,
          allowedRecipients: [],
          allowedRecipientDomains: [],
        },
        confirm: true,
      },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('rejected the request');
    expect(text(result)).toContain('Fix the arguments and retry.');
    await client.close();
  });

  it('surfaces a failed enforcer sync as a non-success line', async () => {
    const warning = 'Policy saved in Wraps, but pushing it to the enforcer failed.';
    mockApi([
      {
        method: 'PATCH',
        path: '/v1/agents/agent_1/policy',
        body: { agent: UPDATED_AGENT, syncStatus: 'failed', warning },
      },
    ]);
    const client = await connectTool(registerSetAgentPolicy, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'set_agent_policy',
      arguments: { id: 'agent_1', policy: POLICY, confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Policy INCOMPLETE/);
    expect(text(result)).toContain('previous policy');
    expect(result.structuredContent).toMatchObject({ syncStatus: 'failed', warning });
    await client.close();
  });
});
