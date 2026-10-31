import { describe, expect, it } from 'vitest';
import { registerGetContact } from '../../tools/get-contact.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const contactBody = {
  id: 'c-42',
  externalId: 'user-42',
  email: 'ada@example.com',
  phone: null,
  firstName: 'Ada',
  lastName: 'Lovelace',
  company: 'Analytical',
  jobTitle: null,
  emailStatus: 'active',
  smsStatus: 'opted_in',
  preferredChannel: 'email',
  properties: { plan: 'pro' },
  emailsSent: 7,
  emailsOpened: 4,
  emailsClicked: 1,
  smsSent: 2,
  smsClicked: 0,
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-02-03T04:05:06.000Z',
  topics: [
    {
      topicId: 't-1',
      topicName: 'Product news',
      status: 'subscribed',
      subscribedAt: '2026-01-03T00:00:00.000Z',
    },
    { topicId: 't-2', topicName: 'Billing', status: 'pending', subscribedAt: null },
  ],
};

describe('get_contact', () => {
  it('looks up one contact by email, encodes the id in the path, and returns its topics', async () => {
    const api = mockApi([
      { method: 'GET', path: '/v1/contacts/ada%40example.com', body: contactBody },
    ]);
    const client = await connectTool(registerGetContact, makeApiConfig());

    const result = await client.callTool({
      name: 'get_contact',
      arguments: { id: 'ada@example.com' },
    });

    expect(result.isError).not.toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('GET');
    expect(api.calls[0]?.path).toBe('/v1/contacts/ada%40example.com');
    expect(api.calls[0]?.query).toEqual({});
    expect(result.structuredContent).toMatchObject({
      id: 'c-42',
      externalId: 'user-42',
      email: 'ada@example.com',
      emailStatus: 'active',
      smsStatus: 'opted_in',
      properties: { plan: 'pro' },
      emailsSent: 7,
    });
    expect((result.structuredContent as { topics: unknown[] }).topics).toEqual([
      {
        topicId: 't-1',
        topicName: 'Product news',
        status: 'subscribed',
        subscribedAt: '2026-01-03T00:00:00.000Z',
      },
      { topicId: 't-2', topicName: 'Billing', status: 'pending', subscribedAt: null },
    ]);
    expect(text(result)).toContain('Product news: subscribed');
    await client.close();
  });

  it('maps a 404 to a tool error that says to check the id with list_contacts', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/contacts/missing-id',
        status: 404,
        body: { error: 'Contact not found' },
      },
    ]);
    const client = await connectTool(registerGetContact, makeApiConfig());

    const result = await client.callTool({ name: 'get_contact', arguments: { id: 'missing-id' } });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('list tool');
    expect(api.calls).toHaveLength(1);
    await client.close();
  });
});
