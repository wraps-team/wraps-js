import { describe, expect, it } from 'vitest';
import { registerListContacts } from '../../tools/list-contacts.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function contactRow(id: string, email: string) {
  return {
    id,
    externalId: null,
    email,
    phone: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    company: null,
    jobTitle: null,
    emailStatus: 'active',
    smsStatus: null,
    preferredChannel: 'email',
    properties: { plan: 'pro' },
    emailsSent: 3,
    emailsOpened: 2,
    emailsClicked: 1,
    smsSent: 0,
    smsClicked: 0,
    createdAt: '2026-01-02T03:04:05.000Z',
    updatedAt: '2026-02-03T04:05:06.000Z',
  };
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('list_contacts', () => {
  it('sends the filters as query parameters and returns the mocked page', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/contacts',
        query: { emailStatus: 'active', preferredChannel: 'email', search: 'ada' },
        body: {
          contacts: [contactRow('c-1', 'ada@example.com')],
          total: 1,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        },
      },
    ]);
    const client = await connectTool(registerListContacts, makeApiConfig());

    const result = await client.callTool({
      name: 'list_contacts',
      arguments: { emailStatus: 'active', preferredChannel: 'email', search: 'ada' },
    });

    expect(result.isError).not.toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('GET');
    expect(api.calls[0]?.path).toBe('/v1/contacts');
    expect(api.calls[0]?.query).toEqual({
      emailStatus: 'active',
      preferredChannel: 'email',
      search: 'ada',
    });
    expect(api.calls[0]?.headers.authorization).toBe('Bearer test-token-not-real');
    expect(result.structuredContent).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      hasMore: false,
    });
    const contacts = (
      result.structuredContent as { contacts: Array<{ id: string; email: string }> }
    ).contacts;
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      id: 'c-1',
      email: 'ada@example.com',
      emailStatus: 'active',
    });
    await client.close();
  });

  it('continues pagination by passing page and pageSize through, and reports hasMore', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/contacts',
        query: { page: '2', pageSize: '10' },
        body: {
          contacts: [contactRow('c-11', 'page2@example.com')],
          total: 25,
          page: 2,
          pageSize: 10,
          totalPages: 3,
        },
      },
    ]);
    const client = await connectTool(registerListContacts, makeApiConfig());

    const result = await client.callTool({
      name: 'list_contacts',
      arguments: { page: 2, pageSize: 10 },
    });

    expect(api.calls[0]?.query).toEqual({ page: '2', pageSize: '10' });
    expect(result.structuredContent).toMatchObject({ page: 2, totalPages: 3, hasMore: true });
    expect(text(result)).toContain('page=3');
    await client.close();
  });

  it('maps an API error to an actionable tool error and sends nothing else', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/contacts',
        status: 401,
        body: { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      },
    ]);
    const client = await connectTool(
      registerListContacts,
      makeApiConfig({
        api: { token: 'k', tokenType: 'api-key', apiBase: 'https://api.wraps.test', source: 'env' },
      })
    );

    const result = await client.callTool({ name: 'list_contacts', arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_API_KEY');
    expect(api.calls).toHaveLength(1);
    await client.close();
  });
});
