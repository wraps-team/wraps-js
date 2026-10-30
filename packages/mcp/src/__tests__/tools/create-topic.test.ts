import { describe, expect, it } from 'vitest';
import { registerCreateTopic } from '../../tools/create-topic.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const CREATED = {
  id: 'topic_new',
  name: 'Billing',
  slug: 'billing',
  description: null,
  public: true,
  doubleOptIn: false,
  subscriberCount: 0,
  sendableCount: 0,
  pendingCount: 0,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  createdBy: { id: 'user_1', name: 'Ada', email: 'ada@example.com' },
};

describe('create_topic', () => {
  it('posts the topic and returns the created record with its id', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/topics', status: 201, body: CREATED }]);
    const client = await connectTool(registerCreateTopic, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'create_topic',
      arguments: { name: 'Billing', public: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: 'topic_new',
      name: 'Billing',
      slug: 'billing',
      subscriberCount: 0,
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/topics',
      query: {},
      body: { name: 'Billing', public: true },
    });
    await client.close();
  });

  it('refuses when write is disabled and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerCreateTopic, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({
      name: 'create_topic',
      arguments: { name: 'Billing' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('maps a duplicate slug (409) to a tool error that says to re-read and retry', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/topics',
        status: 409,
        body: { error: 'Slug "billing" is already in use' },
      },
    ]);
    const client = await connectTool(registerCreateTopic, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'create_topic',
      arguments: { name: 'Billing', slug: 'billing' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Conflict');
    expect(text).toContain('Slug "billing" is already in use');
    expect(text).toContain('Read it again');
    await client.close();
  });
});
