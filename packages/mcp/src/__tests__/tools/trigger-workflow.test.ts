import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerTriggerWorkflow } from '../../tools/trigger-workflow.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function open(writeEnabled: boolean): Promise<Client> {
  const client = await connectTool(registerTriggerWorkflow, makeApiConfig({ writeEnabled }));
  clients.push(client);
  return client;
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const OK_BODY = {
  success: true,
  message: 'Workflow triggered successfully',
  workflowId: 'wf_1',
  workflowName: 'Order follow-up',
  contactId: 'contact_1',
};

describe('trigger_workflow', () => {
  it('posts the contact and event data to the trigger route and returns the resolved contact', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/workflows/wf_1/trigger', body: OK_BODY }]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'trigger_workflow',
      arguments: {
        workflowId: 'wf_1',
        contactId: 'contact_1',
        data: { orderId: 'ord_9' },
        confirm: true,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      id: 'wf_1',
      workflowName: 'Order follow-up',
      contactId: 'contact_1',
      triggered: true,
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/workflows/wf_1/trigger');
    expect(api.calls[0].body).toEqual({
      contactId: 'contact_1',
      data: { orderId: 'ord_9' },
    });
  });

  it('accepts contactEmail instead of contactId', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/workflows/wf_1/trigger', body: OK_BODY }]);
    const client = await open(true);

    await client.callTool({
      name: 'trigger_workflow',
      arguments: { workflowId: 'wf_1', contactEmail: 'ada@example.com', confirm: true },
    });

    expect(api.calls[0].body).toEqual({ contactEmail: 'ada@example.com' });
  });

  it('maps a success:false answer (HTTP 200) to a tool error that names the cause', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/workflows/wf_1/trigger',
        body: { success: false, error: 'Workflow is not enabled' },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'trigger_workflow',
      arguments: { workflowId: 'wf_1', contactId: 'contact_1', confirm: true },
    });

    expect(api.calls).toHaveLength(1);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Workflow is not enabled');
    expect(text(result)).toContain('Nothing was started');
  });

  it('maps an API 404 for an unknown workflow to a tool error', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/workflows/wf_other/trigger',
        status: 404,
        body: { error: 'Workflow not found' },
      },
    ]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'trigger_workflow',
      arguments: { workflowId: 'wf_other', contactId: 'contact_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
  });

  it('refuses without a contact and sends no request', async () => {
    const api = mockApi([]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'trigger_workflow',
      arguments: { workflowId: 'wf_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('pass contactId, or contactEmail');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses without confirm and sends no request', async () => {
    const api = mockApi([]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'trigger_workflow',
      arguments: { workflowId: 'wf_1', contactId: 'contact_1' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('confirm must be true');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses with confirm false and sends no request', async () => {
    const api = mockApi([]);
    const client = await open(true);

    const result = await client.callTool({
      name: 'trigger_workflow',
      arguments: { workflowId: 'wf_1', contactId: 'contact_1', confirm: false },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('refuses when writes are disabled, even with confirm, and sends no request', async () => {
    const api = mockApi([]);
    const client = await open(false);

    const result = await client.callTool({
      name: 'trigger_workflow',
      arguments: { workflowId: 'wf_1', contactId: 'contact_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });
});
