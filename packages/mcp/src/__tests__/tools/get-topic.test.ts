import { describe, expect, it } from 'vitest';
import { registerGetTopic } from '../../tools/get-topic.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const TOPIC = {
  id: 'topic_1',
  name: 'Product news',
  slug: 'product-news',
  description: 'Launches and releases',
  public: true,
  doubleOptIn: true,
  subscriberCount: 120,
  sendableCount: 110,
  pendingCount: 4,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  createdBy: { id: 'user_1', name: 'Ada', email: 'ada@example.com' },
};

describe('get_topic', () => {
  it('returns the single topic with its counts and pins the path sent', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/topics/topic_1', body: TOPIC }]);
    const client = await connectTool(registerGetTopic, makeApiConfig());

    const result = await client.callTool({ name: 'get_topic', arguments: { id: 'topic_1' } });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: 'topic_1',
      slug: 'product-news',
      doubleOptIn: true,
      subscriberCount: 120,
      sendableCount: 110,
      pendingCount: 4,
      createdBy: { id: 'user_1', name: 'Ada', email: 'ada@example.com' },
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/v1/topics/topic_1', query: {} });
    await client.close();
  });

  it('percent-encodes the id in the path so it cannot change the route', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/topics/a%2Fb%20c', body: TOPIC }]);
    const client = await connectTool(registerGetTopic, makeApiConfig());

    const result = await client.callTool({ name: 'get_topic', arguments: { id: 'a/b c' } });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].path).toBe('/v1/topics/a%2Fb%20c');
    await client.close();
  });

  it('maps a missing topic (404) to a tool error that says to check the id', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/topics/topic_gone',
        status: 404,
        body: { error: 'Topic not found' },
      },
    ]);
    const client = await connectTool(registerGetTopic, makeApiConfig());

    const result = await client.callTool({
      name: 'get_topic',
      arguments: { id: 'topic_gone' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Not found in this organization');
    expect(text).toContain('Topic not found');
    expect(text).toContain('list tool');
    await client.close();
  });
});
