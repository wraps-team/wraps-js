import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerEnableWorkflowSchedule } from '../../tools/enable-workflow-schedule.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function open(writeEnabled: boolean): Promise<Client> {
  const client = await connectTool(registerEnableWorkflowSchedule, makeApiConfig({ writeEnabled }));
  clients.push(client);
  return client;
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('enable_workflow_schedule', () => {
  it('posts the cron and timezone to the enable route and returns the schedule name', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/workflow-schedules/wf_1/enable',
        body: { success: true, scheduleName: 'wraps-workflow-wf_1-next' },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'enable_workflow_schedule',
      arguments: { workflowId: 'wf_1', cronExpression: '0 9 * * 1', timezone: 'Europe/London' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      id: 'wf_1',
      scheduleName: 'wraps-workflow-wf_1-next',
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/workflow-schedules/wf_1/enable');
    expect(api.calls[0].body).toEqual({ cronExpression: '0 9 * * 1', timezone: 'Europe/London' });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('omits timezone from the body when none is given', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/workflow-schedules/wf_1/enable',
        body: { success: true, scheduleName: 'wraps-workflow-wf_1-next' },
      },
    ]);
    const client = await open(true);

    await client.callTool({
      name: 'enable_workflow_schedule',
      arguments: { workflowId: 'wf_1', cronExpression: '0 9 * * 1' },
    });

    expect(api.calls[0].body).toEqual({ cronExpression: '0 9 * * 1' });
  });

  it('maps a 404 to a tool error that says the workflow is not in this organization', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/workflow-schedules/wf_other/enable',
        status: 404,
        body: { success: false, error: 'Workflow not found' },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'enable_workflow_schedule',
      arguments: { workflowId: 'wf_other', cronExpression: '0 9 * * 1' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('Workflow not found');
  });

  it('refuses when writes are disabled and sends no request', async () => {
    const api = mockApi([]);
    const client = await open(false);

    const result = await client.callTool({
      name: 'enable_workflow_schedule',
      arguments: { workflowId: 'wf_1', cronExpression: '0 9 * * 1' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
