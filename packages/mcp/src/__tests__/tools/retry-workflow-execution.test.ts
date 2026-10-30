import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerRetryWorkflowExecution } from '../../tools/retry-workflow-execution.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function open(writeEnabled: boolean): Promise<Client> {
  const client = await connectTool(registerRetryWorkflowExecution, makeApiConfig({ writeEnabled }));
  clients.push(client);
  return client;
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('retry_workflow_execution', () => {
  it('posts to the retry route and returns the execution id and API message', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/workflows/executions/exec_1/retry',
        body: { success: true, message: 'Execution retry started' },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'retry_workflow_execution',
      arguments: { executionId: 'exec_1', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      id: 'exec_1',
      message: 'Execution retry started',
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/workflows/executions/exec_1/retry');
    expect(api.calls[0].body).toBeUndefined();
  });

  it('maps a success:false answer (HTTP 200) to a tool error that names the cause', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/workflows/executions/exec_1/retry',
        body: { success: false, error: 'Only failed executions can be retried' },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'retry_workflow_execution',
      arguments: { executionId: 'exec_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Only failed executions can be retried');
    expect(text(result)).toContain('Nothing was changed');
  });

  it('maps an API 500 to a tool error with the API message', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/workflows/executions/exec_1/retry',
        status: 500,
        body: { error: 'Failed to enqueue execution retry' },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'retry_workflow_execution',
      arguments: { executionId: 'exec_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Failed to enqueue execution retry');
  });

  it('refuses without confirm and sends no request', async () => {
    const api = mockApi([]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'retry_workflow_execution',
      arguments: { executionId: 'exec_1' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('confirm must be true');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses when writes are disabled, even with confirm, and sends no request', async () => {
    const api = mockApi([]);
    const client = await open(false);

    const result = await client.callTool({
      name: 'retry_workflow_execution',
      arguments: { executionId: 'exec_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
