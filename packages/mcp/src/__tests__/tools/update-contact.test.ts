import { describe, expect, it } from 'vitest';
import { registerUpdateContact } from '../../tools/update-contact.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

const updatedBody = {
  id: 'c-42',
  externalId: 'user-42',
  email: 'ada@example.com',
  phone: null,
  firstName: 'Ada',
  lastName: 'King',
  company: null,
  jobTitle: 'Engineer',
  emailStatus: 'active',
  smsStatus: null,
  preferredChannel: 'email',
  properties: { plan: 'pro' },
  emailsSent: 7,
  emailsOpened: 4,
  emailsClicked: 1,
  smsSent: 0,
  smsClicked: 0,
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-03-04T05:06:07.000Z',
};

describe('update_contact', () => {
  it('patches only the given fields, keeps the id out of the body, and returns the record', async () => {
    const api = mockApi([{ method: 'PATCH', path: '/v1/contacts/c-42', body: updatedBody }]);
    const client = await connectTool(registerUpdateContact, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_contact',
      arguments: { id: 'c-42', lastName: 'King', company: null, jobTitle: 'Engineer' },
    });

    expect(result.isError).not.toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('PATCH');
    expect(api.calls[0]?.path).toBe('/v1/contacts/c-42');
    expect(api.calls[0]?.body).toEqual({ lastName: 'King', company: null, jobTitle: 'Engineer' });
    expect(result.structuredContent).toMatchObject({
      id: 'c-42',
      lastName: 'King',
      company: null,
      jobTitle: 'Engineer',
    });
    expect(text(result)).toContain('c-42');
    await client.close();
  });

  it('is refused when writes are disabled, with no request sent', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerUpdateContact, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({
      name: 'update_contact',
      arguments: { id: 'c-42', firstName: 'Ada' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('maps a 409 conflict to a tool error that says to read again', async () => {
    const api = mockApi([
      {
        method: 'PATCH',
        path: '/v1/contacts/c-42',
        status: 409,
        body: { error: 'Contact with this email already exists' },
      },
    ]);
    const client = await connectTool(registerUpdateContact, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_contact',
      arguments: { id: 'c-42', email: 'taken@example.com' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Conflict');
    expect(text(result)).toContain('Contact with this email already exists');
    expect(text(result)).toContain('Read it again');
    expect(api.calls).toHaveLength(1);
    await client.close();
  });
});
