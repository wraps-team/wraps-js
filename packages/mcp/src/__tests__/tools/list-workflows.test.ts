import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerListWorkflows } from '../../tools/list-workflows.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function open(writeEnabled = false): Promise<Client> {
  const client = await connectTool(registerListWorkflows, makeApiConfig({ writeEnabled }));
  clients.push(client);
  return client;
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const WORKFLOW = {
  id: 'wf_1',
  organizationId: 'org_1',
  name: 'Welcome series',
  description: null,
  status: 'enabled',
  triggerType: 'api',
  version: 3,
  totalExecutions: 10,
  activeExecutions: 2,
  completedExecutions: 7,
  failedExecutions: 1,
  createdBy: 'user_1',
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-02-02T03:04:05.000Z',
};

describe('list_workflows', () => {
  it('lists workflows with pinned structured output and sends no query when no filters are given', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/workflows',
        body: { workflows: [WORKFLOW], total: 1, page: 1, pageSize: 50 },
      },
    ]);
    const client = await open();

    const result = await client.callTool({ name: 'list_workflows', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      workflows: [
        {
          id: 'wf_1',
          name: 'Welcome series',
          description: null,
          status: 'enabled',
          triggerType: 'api',
          version: 3,
          totalExecutions: 10,
          activeExecutions: 2,
          completedExecutions: 7,
          failedExecutions: 1,
          createdAt: '2026-01-02T03:04:05.000Z',
          updatedAt: '2026-02-02T03:04:05.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      hasMore: false,
    });
    expect(text(result)).toContain('wf_1');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/workflows');
    expect(api.calls[0].query).toEqual({});
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('continues pagination by passing page and the filters through, and reports hasMore', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/workflows',
        query: { page: '2', pageSize: '1', status: 'enabled', search: 'welcome' },
        body: { workflows: [WORKFLOW], total: 3, page: 2, pageSize: 1 },
      },
    ]);
    const client = await open();

    const result = await client.callTool({
      name: 'list_workflows',
      arguments: { page: 2, pageSize: 1, status: 'enabled', search: 'welcome' },
    });

    expect(api.calls[0].query).toEqual({
      page: '2',
      pageSize: '1',
      status: 'enabled',
      search: 'welcome',
    });
    expect(result.structuredContent).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 3,
      hasMore: true,
    });
    expect(text(result)).toContain('page=3');
  });

  it('maps an API error to a tool error that names the permission or plan fix', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/workflows',
        status: 403,
        body: { error: "You don't have permission to perform this action" },
      },
    ]);
    const client = await open();

    const result = await client.callTool({ name: 'list_workflows', arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Permission denied');
    expect(text(result)).toContain('check your plan');
  });

  it('refuses an invalid status before any request is sent', async () => {
    const api = mockApi([]);
    const client = await open();

    const result = await client.callTool({
      name: 'list_workflows',
      arguments: { status: 'bogus' },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});
