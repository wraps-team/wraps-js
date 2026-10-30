import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerListWorkflowExecutions } from '../../tools/list-workflow-executions.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function open(writeEnabled = false): Promise<Client> {
  const client = await connectTool(registerListWorkflowExecutions, makeApiConfig({ writeEnabled }));
  clients.push(client);
  return client;
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const EXECUTION = {
  id: 'exec_1',
  workflowId: 'wf_1',
  contactId: 'contact_1',
  organizationId: 'org_1',
  status: 'failed',
  currentStepId: 'step_2',
  startedAt: '2026-03-01T10:00:00.000Z',
  completedAt: '2026-03-01T10:05:00.000Z',
  createdAt: '2026-03-01T09:59:00.000Z',
  updatedAt: '2026-03-01T10:05:00.000Z',
  contact: {
    id: 'contact_1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: null,
  },
};

describe('list_workflow_executions', () => {
  it('lists executions with pinned structured output and sends a GET for the workflow', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/workflows/wf_1/executions',
        body: { executions: [EXECUTION], total: 1, page: 1, pageSize: 50 },
      },
    ]);
    const client = await open();

    const result = await client.callTool({
      name: 'list_workflow_executions',
      arguments: { workflowId: 'wf_1' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      executions: [
        {
          id: 'exec_1',
          workflowId: 'wf_1',
          contactId: 'contact_1',
          status: 'failed',
          currentStepId: 'step_2',
          startedAt: '2026-03-01T10:00:00.000Z',
          completedAt: '2026-03-01T10:05:00.000Z',
          createdAt: '2026-03-01T09:59:00.000Z',
          updatedAt: '2026-03-01T10:05:00.000Z',
          contact: { id: 'contact_1', email: 'ada@example.com', firstName: 'Ada', lastName: null },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      hasMore: false,
    });
    expect(text(result)).toContain('exec_1');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/workflows/wf_1/executions');
    expect(api.calls[0].query).toEqual({});
  });

  it('continues pagination by passing page, pageSize and status, and reports hasMore', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/workflows/wf_1/executions',
        query: { page: '2', pageSize: '1', status: 'failed' },
        body: { executions: [EXECUTION], total: 4, page: 2, pageSize: 1 },
      },
    ]);
    const client = await open();

    const result = await client.callTool({
      name: 'list_workflow_executions',
      arguments: { workflowId: 'wf_1', page: 2, pageSize: 1, status: 'failed' },
    });

    expect(api.calls[0].query).toEqual({ page: '2', pageSize: '1', status: 'failed' });
    expect(result.structuredContent).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 4,
      hasMore: true,
    });
    expect(text(result)).toContain('page=3');
  });

  it('maps a 404 for a workflow outside this organization to a tool error', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/workflows/wf_other/executions',
        status: 404,
        body: { error: 'Workflow not found' },
      },
    ]);
    const client = await open();

    const result = await client.callTool({
      name: 'list_workflow_executions',
      arguments: { workflowId: 'wf_other' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('Workflow not found');
  });
});
