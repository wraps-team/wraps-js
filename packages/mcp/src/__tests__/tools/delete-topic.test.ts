import { describe, expect, it } from 'vitest';
import { registerDeleteTopic } from '../../tools/delete-topic.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

describe('delete_topic', () => {
  it('sends DELETE with confirm=true and returns the id that was deleted', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: '/v1/topics/topic_1',
        query: { confirm: 'true' },
        body: { success: true },
      },
    ]);
    const client = await connectTool(registerDeleteTopic, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_topic',
      arguments: { id: 'topic_1', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ id: 'topic_1', success: true });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'DELETE',
      path: '/v1/topics/topic_1',
      query: { confirm: 'true' },
    });
    await client.close();
  });

  it('refuses without confirm and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerDeleteTopic, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_topic',
      arguments: { id: 'topic_1' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('confirm: true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('refuses when write is disabled, even with confirm, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerDeleteTopic, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({
      name: 'delete_topic',
      arguments: { id: 'topic_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('maps a missing topic (404) to a tool error that says to check the id', async () => {
    mockApi([
      {
        method: 'DELETE',
        path: '/v1/topics/topic_gone',
        query: { confirm: 'true' },
        status: 404,
        body: { error: 'Topic not found' },
      },
    ]);
    const client = await connectTool(registerDeleteTopic, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_topic',
      arguments: { id: 'topic_gone', confirm: true },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Not found in this organization');
    expect(text).toContain('Topic not found');
    await client.close();
  });
});
