import { describe, expect, it } from 'vitest';
import { registerUpdateTopic } from '../../tools/update-topic.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const UPDATED = {
  id: 'topic_1',
  name: 'Release notes',
  slug: 'product-news',
  description: null,
  public: false,
  doubleOptIn: true,
  subscriberCount: 120,
  sendableCount: 110,
  pendingCount: 4,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  createdBy: null,
};

describe('update_topic', () => {
  it('sends only the passed fields and returns the updated topic', async () => {
    const api = mockApi([
      {
        method: 'PATCH',
        path: '/v1/topics/topic_1',
        body: UPDATED,
      },
    ]);
    const client = await connectTool(registerUpdateTopic, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_topic',
      arguments: { id: 'topic_1', name: 'Release notes', public: false, description: null },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: 'topic_1',
      name: 'Release notes',
      public: false,
      description: null,
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'PATCH',
      path: '/v1/topics/topic_1',
      query: {},
      body: { name: 'Release notes', public: false, description: null },
    });
    await client.close();
  });

  it('refuses when write is disabled and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerUpdateTopic, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({
      name: 'update_topic',
      arguments: { id: 'topic_1', name: 'Renamed' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('maps a slug conflict (409) to a tool error that says to re-read and retry', async () => {
    mockApi([
      {
        method: 'PATCH',
        path: '/v1/topics/topic_1',
        status: 409,
        body: { error: 'A topic with this slug already exists' },
      },
    ]);
    const client = await connectTool(registerUpdateTopic, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_topic',
      arguments: { id: 'topic_1', slug: 'billing' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Conflict');
    expect(text).toContain('A topic with this slug already exists');
    expect(text).toContain('Read it again');
    await client.close();
  });
});
