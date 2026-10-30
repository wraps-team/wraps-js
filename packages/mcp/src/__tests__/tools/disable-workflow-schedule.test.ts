import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerDisableWorkflowSchedule } from '../../tools/disable-workflow-schedule.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function open(writeEnabled: boolean): Promise<Client> {
  const client = await connectTool(
    registerDisableWorkflowSchedule,
    makeApiConfig({ writeEnabled })
  );
  clients.push(client);
  return client;
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('disable_workflow_schedule', () => {
  it('posts to the disable route and reports the schedule as disabled', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/workflow-schedules/wf_1/disable',
        body: { success: true },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'disable_workflow_schedule',
      arguments: { workflowId: 'wf_1' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ id: 'wf_1', disabled: true });
    expect(text(result)).toContain('workflow and its executions were not changed');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/workflow-schedules/wf_1/disable');
    expect(api.calls[0].body).toBeUndefined();
  });

  it('maps a 500 from the scheduler to a tool error that carries the API message', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/workflow-schedules/wf_1/disable',
        status: 500,
        body: { success: false, error: 'EventBridge unavailable' },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'disable_workflow_schedule',
      arguments: { workflowId: 'wf_1' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Wraps API error (HTTP 500)');
    expect(text(result)).toContain('EventBridge unavailable');
  });

  it('refuses when writes are disabled and sends no request', async () => {
    const api = mockApi([]);
    const client = await open(false);

    const result = await client.callTool({
      name: 'disable_workflow_schedule',
      arguments: { workflowId: 'wf_1' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
