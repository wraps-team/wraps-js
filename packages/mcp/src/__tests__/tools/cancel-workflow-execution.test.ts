import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCancelWorkflowExecution } from '../../tools/cancel-workflow-execution.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function open(writeEnabled: boolean): Promise<Client> {
  const client = await connectTool(
    registerCancelWorkflowExecution,
    makeApiConfig({ writeEnabled })
  );
  clients.push(client);
  return client;
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('cancel_workflow_execution', () => {
  it('posts to the cancel route and reports the execution as cancelled', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/workflows/executions/exec_1/cancel',
        body: { success: true },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'cancel_workflow_execution',
      arguments: { executionId: 'exec_1', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ id: 'exec_1', cancelled: true });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/workflows/executions/exec_1/cancel');
    expect(api.calls[0].body).toBeUndefined();
  });

  it('maps a success:false answer (HTTP 200) to a tool error that names the cause', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/workflows/executions/exec_1/cancel',
        body: { success: false, error: 'Execution in "completed" status cannot be cancelled' },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'cancel_workflow_execution',
      arguments: { executionId: 'exec_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('cannot be cancelled');
    expect(text(result)).toContain('Nothing was changed');
  });

  it('refuses without confirm and sends no request', async () => {
    const api = mockApi([]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'cancel_workflow_execution',
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
      name: 'cancel_workflow_execution',
      arguments: { executionId: 'exec_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
