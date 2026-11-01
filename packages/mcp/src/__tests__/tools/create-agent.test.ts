import { describe, expect, it } from 'vitest';
import { registerCreateAgent } from '../../tools/create-agent.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const CREATED = {
  id: 'agent_9',
  organizationId: 'org_1',
  name: 'Support bot',
  emailAddress: 'support-bot@example.com',
  domain: 'example.com',
  status: 'ACTIVE',
  policy: {
    maxPerHour: 5,
    maxPerDay: 50,
    allowedRecipients: ['vip@example.com'],
    allowedRecipientDomains: [],
  },
  credentialUserArn: null,
  enforcerFunctionArn: null,
  awsAccountId: null,
  createdBy: 'user_1',
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
};

describe('create_agent', () => {
  it('refuses without WRAPS_WRITE_ENABLED and makes no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerCreateAgent, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({
      name: 'create_agent',
      arguments: {
        name: 'Support bot',
        emailAddress: 'support-bot@example.com',
        domain: 'example.com',
      },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('creates the agent with a POST and sends the body it was given', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/agents',
        status: 201,
        body: CREATED,
      },
    ]);
    const client = await connectTool(registerCreateAgent, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'create_agent',
      arguments: {
        name: 'Support bot',
        emailAddress: 'support-bot@example.com',
        domain: 'example.com',
        policy: {
          maxPerHour: 5,
          maxPerDay: 50,
          allowedRecipients: ['vip@example.com'],
          allowedRecipientDomains: [],
        },
      },
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Created agent Support bot (agent_9)');
    expect(result.structuredContent).toEqual(CREATED);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/agents',
      body: {
        name: 'Support bot',
        emailAddress: 'support-bot@example.com',
        domain: 'example.com',
        policy: {
          maxPerHour: 5,
          maxPerDay: 50,
          allowedRecipients: ['vip@example.com'],
          allowedRecipientDomains: [],
        },
      },
    });
    await client.close();
  });

  it('omits policy from the body when none is given, so the API default applies', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/agents', status: 201, body: CREATED }]);
    const client = await connectTool(registerCreateAgent, makeApiConfig({ writeEnabled: true }));

    await client.callTool({
      name: 'create_agent',
      arguments: {
        name: 'Support bot',
        emailAddress: 'support-bot@example.com',
        domain: 'example.com',
      },
    });

    expect(api.calls[0].body).toEqual({
      name: 'Support bot',
      emailAddress: 'support-bot@example.com',
      domain: 'example.com',
    });
    await client.close();
  });
});
