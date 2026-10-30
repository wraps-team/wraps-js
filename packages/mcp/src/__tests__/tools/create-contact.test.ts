import { describe, expect, it } from 'vitest';
import { registerCreateContact } from '../../tools/create-contact.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const createdBody = {
  id: 'c-new',
  externalId: 'user-7',
  email: 'grace@example.com',
  phone: null,
  firstName: 'Grace',
  lastName: 'Hopper',
  company: null,
  jobTitle: null,
  emailStatus: 'active',
  smsStatus: null,
  preferredChannel: 'email',
  properties: { source: 'signup' },
  emailsSent: 0,
  emailsOpened: 0,
  emailsClicked: 0,
  smsSent: 0,
  smsClicked: 0,
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  pendingTopics: ['t-billing'],
};

const args = {
  externalId: 'user-7',
  email: 'grace@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
  properties: { source: 'signup' },
  topicSlugs: ['billing'],
};

describe('create_contact', () => {
  it('posts the contact body and returns the created record with pendingTopics', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/contacts', status: 201, body: createdBody }]);
    const client = await connectTool(registerCreateContact, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({ name: 'create_contact', arguments: args });

    expect(result.isError).not.toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('POST');
    expect(api.calls[0]?.path).toBe('/v1/contacts');
    expect(api.calls[0]?.body).toEqual(args);
    expect(result.structuredContent).toMatchObject({
      id: 'c-new',
      email: 'grace@example.com',
      externalId: 'user-7',
      emailStatus: 'active',
      pendingTopics: ['t-billing'],
    });
    expect(text(result)).toContain('c-new');
    expect(text(result)).toContain('pendingTopics');
    await client.close();
  });

  it('is refused when writes are disabled, with no request sent', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerCreateContact, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({ name: 'create_contact', arguments: args });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('maps a 409 duplicate to a tool error that names the conflict and says to read again', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/contacts',
        status: 409,
        body: { error: 'Contact with this email already exists' },
      },
    ]);
    const client = await connectTool(registerCreateContact, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({ name: 'create_contact', arguments: args });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Conflict');
    expect(text(result)).toContain('Contact with this email already exists');
    expect(text(result)).toContain('Read it again');
    expect(api.calls).toHaveLength(1);
    await client.close();
  });
});
