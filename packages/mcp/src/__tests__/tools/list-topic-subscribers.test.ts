import { describe, expect, it } from 'vitest';
import { registerListTopicSubscribers } from '../../tools/list-topic-subscribers.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const ADA = {
  contactId: 'contact_1',
  email: 'ada@example.com',
  status: 'subscribed',
  subscribedAt: '2026-10-01T00:00:00.000Z',
  unsubscribedAt: null,
};

const GRACE = {
  contactId: 'contact_2',
  email: 'grace@example.com',
  status: 'pending',
  subscribedAt: null,
  unsubscribedAt: null,
};

const LINUS = {
  contactId: 'contact_3',
  email: 'linus@example.com',
  status: 'subscribed',
  subscribedAt: '2026-10-03T00:00:00.000Z',
  unsubscribedAt: null,
};

describe('list_topic_subscribers', () => {
  it('returns the first page with hasMore and nextPage when more pages exist', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/topics/topic_1/subscribers',
        query: { pageSize: '2' },
        body: { subscribers: [ADA, GRACE], total: 3, page: 1, pageSize: 2 },
      },
    ]);
    const client = await connectTool(registerListTopicSubscribers, makeApiConfig());

    const result = await client.callTool({
      name: 'list_topic_subscribers',
      arguments: { id: 'topic_1', pageSize: 2 },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 2,
      hasMore: true,
      nextPage: 2,
    });
    const data = result.structuredContent as { subscribers: Array<Record<string, unknown>> };
    expect(data.subscribers[0]).toMatchObject({
      id: 'contact_1',
      contactId: 'contact_1',
      email: 'ada@example.com',
      status: 'subscribed',
    });
    expect(data.subscribers[1]).toMatchObject({ id: 'contact_2', status: 'pending' });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'GET',
      path: '/v1/topics/topic_1/subscribers',
      query: { pageSize: '2' },
    });
    await client.close();
  });

  it('continues with the page and filters passed in, and reports the last page', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/topics/topic_1/subscribers',
        query: { page: '2', pageSize: '2', status: 'subscribed' },
        body: { subscribers: [LINUS], total: 3, page: 2, pageSize: 2 },
      },
    ]);
    const client = await connectTool(registerListTopicSubscribers, makeApiConfig());

    const result = await client.callTool({
      name: 'list_topic_subscribers',
      arguments: { id: 'topic_1', page: 2, pageSize: 2, status: 'subscribed' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      total: 3,
      page: 2,
      hasMore: false,
      nextPage: null,
    });
    const data = result.structuredContent as { subscribers: Array<Record<string, unknown>> };
    expect(data.subscribers).toHaveLength(1);
    expect(data.subscribers[0]).toMatchObject({ id: 'contact_3', email: 'linus@example.com' });
    expect(api.calls[0].query).toEqual({ page: '2', pageSize: '2', status: 'subscribed' });
    await client.close();
  });

  it('rejects a pageSize above the route limit before sending a request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerListTopicSubscribers, makeApiConfig());

    const result = await client.callTool({
      name: 'list_topic_subscribers',
      arguments: { id: 'topic_1', pageSize: 500 },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('maps a missing topic (404) to a tool error that says to check the id', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/topics/topic_gone/subscribers',
        status: 404,
        body: { error: 'Topic not found' },
      },
    ]);
    const client = await connectTool(registerListTopicSubscribers, makeApiConfig());

    const result = await client.callTool({
      name: 'list_topic_subscribers',
      arguments: { id: 'topic_gone' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Not found in this organization');
    expect(text).toContain('Topic not found');
    await client.close();
  });
});
