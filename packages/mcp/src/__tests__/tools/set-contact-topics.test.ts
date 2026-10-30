import { describe, expect, it } from 'vitest';
import { registerSetContactTopics } from '../../tools/set-contact-topics.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const replacedBody = {
  topics: [
    {
      topicId: 't-1',
      topicName: 'Product news',
      status: 'subscribed',
      subscribedAt: '2026-03-01T00:00:00.000Z',
    },
    { topicId: 't-billing', topicName: 'Billing', status: 'pending', subscribedAt: null },
  ],
  pendingTopics: ['t-billing'],
};

describe('set_contact_topics', () => {
  it('puts the full topic list to the contact topics route and returns the replaced list', async () => {
    const api = mockApi([{ method: 'PUT', path: '/v1/contacts/c-42/topics', body: replacedBody }]);
    const client = await connectTool(
      registerSetContactTopics,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'set_contact_topics',
      arguments: { id: 'c-42', topicIds: ['t-1'], topicSlugs: ['billing'] },
    });

    expect(result.isError).not.toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('PUT');
    expect(api.calls[0]?.path).toBe('/v1/contacts/c-42/topics');
    expect(api.calls[0]?.body).toEqual({ topicIds: ['t-1'], topicSlugs: ['billing'] });
    expect(result.structuredContent).toMatchObject({
      id: 'c-42',
      pendingTopics: ['t-billing'],
    });
    expect((result.structuredContent as { topics: unknown[] }).topics).toHaveLength(2);
    expect(text(result)).toContain('Billing: pending');
    await client.close();
  });

  it('is refused when writes are disabled, with no request sent', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerSetContactTopics,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'set_contact_topics',
      arguments: { id: 'c-42', topicIds: ['t-1'] },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('maps a 404 to a tool error that says to check the id with the list tool', async () => {
    const api = mockApi([
      {
        method: 'PUT',
        path: '/v1/contacts/c-missing/topics',
        status: 404,
        body: { error: 'Contact not found' },
      },
    ]);
    const client = await connectTool(
      registerSetContactTopics,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'set_contact_topics',
      arguments: { id: 'c-missing', topicIds: [] },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('list tool');
    expect(api.calls).toHaveLength(1);
    await client.close();
  });
});
