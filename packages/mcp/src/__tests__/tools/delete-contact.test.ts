import { describe, expect, it } from 'vitest';
import { registerDeleteContact } from '../../tools/delete-contact.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('delete_contact', () => {
  it('deletes the contact by id with confirm: true and returns the id and deleted flag', async () => {
    const api = mockApi([{ method: 'DELETE', path: '/v1/contacts/c-42', body: { success: true } }]);
    const client = await connectTool(registerDeleteContact, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_contact',
      arguments: { id: 'c-42', confirm: true },
    });

    expect(result.isError).not.toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('DELETE');
    expect(api.calls[0]?.path).toBe('/v1/contacts/c-42');
    expect(api.calls[0]?.body).toBeUndefined();
    expect(result.structuredContent).toEqual({ id: 'c-42', deleted: true });
    expect(text(result)).toContain('cannot be undone');
    await client.close();
  });

  it('is refused without confirm, before any request is sent', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerDeleteContact, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_contact',
      arguments: { id: 'c-42' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('confirm must be true');
    expect(text(result)).toContain('Re-run with confirm: true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('is refused when writes are disabled, with no request sent', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerDeleteContact, makeApiConfig({ writeEnabled: false }));

    const result = await client.callTool({
      name: 'delete_contact',
      arguments: { id: 'c-42', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('maps a 404 to a tool error that says to check the id with the list tool', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: '/v1/contacts/c-gone',
        status: 404,
        body: { error: 'Contact not found' },
      },
    ]);
    const client = await connectTool(registerDeleteContact, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_contact',
      arguments: { id: 'c-gone', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('list tool');
    expect(api.calls).toHaveLength(1);
    await client.close();
  });
});
