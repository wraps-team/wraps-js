import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGetWorkflowExecution } from '../../tools/get-workflow-execution.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function open(writeEnabled = false): Promise<Client> {
  const client = await connectTool(registerGetWorkflowExecution, makeApiConfig({ writeEnabled }));
  clients.push(client);
  return client;
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('get_workflow_execution', () => {
  it('returns one execution with its step trace and sends a GET for its id', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/workflows/executions/exec_1',
        body: {
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
          contact: { id: 'contact_1', email: 'ada@example.com', firstName: 'Ada', lastName: null },
          workflow: { name: 'Welcome series' },
          stepExecutions: [
            {
              id: 'se_1',
              executionId: 'exec_1',
              stepId: 'step_1',
              stepType: 'send_email',
              status: 'completed',
              createdAt: '2026-03-01T10:00:00.000Z',
              extra: 'dropped',
            },
            {
              id: 'se_2',
              executionId: 'exec_1',
              stepId: 'step_2',
              stepType: 'wait',
              status: 'failed',
              createdAt: '2026-03-01T10:04:00.000Z',
            },
          ],
          stepEngagement: { step_1: { opens: 1 } },
        },
      },
    ]);
    const client = await open();

    const result = await client.callTool({
      name: 'get_workflow_execution',
      arguments: { executionId: 'exec_1' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
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
      workflow: { name: 'Welcome series' },
      stepExecutions: [
        {
          id: 'se_1',
          executionId: 'exec_1',
          stepId: 'step_1',
          stepType: 'send_email',
          status: 'completed',
          createdAt: '2026-03-01T10:00:00.000Z',
        },
        {
          id: 'se_2',
          executionId: 'exec_1',
          stepId: 'step_2',
          stepType: 'wait',
          status: 'failed',
          createdAt: '2026-03-01T10:04:00.000Z',
        },
      ],
      stepEngagement: { step_1: { opens: 1 } },
    });
    expect(text(result)).toContain('failed');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/workflows/executions/exec_1');
    expect(api.calls[0].query).toEqual({});
  });

  it('maps a 404 to a tool error that says the execution is not in this organization', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/workflows/executions/exec_gone',
        status: 404,
        body: { error: 'Execution not found' },
      },
    ]);
    const client = await open();

    const result = await client.callTool({
      name: 'get_workflow_execution',
      arguments: { executionId: 'exec_gone' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('Execution not found');
  });
});
