import { describe, expect, it } from 'vitest';
import { registerListTopics } from '../../tools/list-topics.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const TOPIC = {
  id: 'topic_1',
  name: 'Product news',
  slug: 'product-news',
  description: null,
  public: true,
  doubleOptIn: false,
  subscriberCount: 120,
  sendableCount: 110,
  pendingCount: 4,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  createdBy: { id: 'user_1', name: 'Ada', email: 'ada@example.com' },
};

const SECOND = { ...TOPIC, id: 'topic_2', name: 'Billing', slug: 'billing', createdBy: null };

describe('list_topics', () => {
  it('lists every topic with its counts and pins the request sent', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/topics', body: { topics: [TOPIC, SECOND] } }]);
    const client = await connectTool(registerListTopics, makeApiConfig());

    const result = await client.callTool({ name: 'list_topics', arguments: {} });

    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as { topics: Array<Record<string, unknown>> };
    expect(data.topics).toHaveLength(2);
    expect(data.topics[0]).toMatchObject({
      id: 'topic_1',
      slug: 'product-news',
      subscriberCount: 120,
      sendableCount: 110,
      pendingCount: 4,
    });
    expect(data.topics[1]).toMatchObject({ id: 'topic_2', createdBy: null });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/v1/topics', query: {} });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    await client.close();
  });

  it('is read-only and sends no query, so there is no cursor to continue with', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/topics', body: { topics: [] } }]);
    const client = await connectTool(registerListTopics, makeApiConfig());

    const result = await client.callTool({ name: 'list_topics', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ topics: [] });
    expect(api.calls[0].query).toEqual({});
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'list_topics');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    await client.close();
  });

  it('maps a plan refusal (403) to a tool error that names the fix', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/topics',
        status: 403,
        body: { error: 'Topics need a Pro plan', code: 'PLAN_REQUIRED' },
      },
    ]);
    const client = await connectTool(registerListTopics, makeApiConfig());

    const result = await client.callTool({ name: 'list_topics', arguments: {} });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Permission denied');
    expect(text).toContain('PLAN_REQUIRED');
    expect(text).toContain('Pro plan');
    await client.close();
  });

  it('refuses without sending a request when no Wraps credential is configured', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerListTopics, makeApiConfig({ api: null }));

    const result = await client.callTool({ name: 'list_topics', arguments: {} });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });
});
