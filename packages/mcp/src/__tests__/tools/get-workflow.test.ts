import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGetWorkflow } from '../../tools/get-workflow.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function open(writeEnabled = false): Promise<Client> {
  const client = await connectTool(registerGetWorkflow, makeApiConfig({ writeEnabled }));
  clients.push(client);
  return client;
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const STEPS = [{ id: 'step_1', type: 'send_email' }];
const TRANSITIONS = [{ from: 'step_1', to: 'end' }];

describe('get_workflow', () => {
  it('returns one workflow with its steps and transitions, and sends a GET for its id', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/workflows/wf_1',
        body: {
          id: 'wf_1',
          organizationId: 'org_1',
          name: 'Welcome series',
          description: 'Onboarding',
          status: 'enabled',
          triggerType: 'api',
          triggerConfig: { mode: 'api' },
          steps: STEPS,
          transitions: TRANSITIONS,
          version: 3,
          totalExecutions: 10,
          activeExecutions: 2,
          completedExecutions: 7,
          failedExecutions: 1,
          createdBy: 'user_1',
          createdAt: '2026-01-02T03:04:05.000Z',
          updatedAt: '2026-02-02T03:04:05.000Z',
        },
      },
    ]);
    const client = await open();

    const result = await client.callTool({
      name: 'get_workflow',
      arguments: { workflowId: 'wf_1' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      id: 'wf_1',
      name: 'Welcome series',
      description: 'Onboarding',
      status: 'enabled',
      triggerType: 'api',
      triggerConfig: { mode: 'api' },
      steps: STEPS,
      transitions: TRANSITIONS,
      version: 3,
      totalExecutions: 10,
      activeExecutions: 2,
      completedExecutions: 7,
      failedExecutions: 1,
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-02-02T03:04:05.000Z',
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/workflows/wf_1');
    expect(api.calls[0].query).toEqual({});
  });

  it('percent-encodes the workflow id in the path', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/workflows/a%2Fb',
        body: {
          id: 'a/b',
          name: 'Odd id',
          description: null,
          status: 'draft',
          triggerType: null,
          version: 1,
          totalExecutions: 0,
          activeExecutions: 0,
          completedExecutions: 0,
          failedExecutions: 0,
          createdAt: '2026-01-02T03:04:05.000Z',
          updatedAt: '2026-01-02T03:04:05.000Z',
        },
      },
    ]);
    const client = await open();

    await client.callTool({ name: 'get_workflow', arguments: { workflowId: 'a/b' } });

    expect(api.calls[0].path).toBe('/v1/workflows/a%2Fb');
  });

  it('maps a 404 to a tool error that says the id is not in this organization', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/workflows/wf_missing',
        status: 404,
        body: { error: 'Workflow not found' },
      },
    ]);
    const client = await open();

    const result = await client.callTool({
      name: 'get_workflow',
      arguments: { workflowId: 'wf_missing' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('list tool');
  });
});
