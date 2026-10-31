import { describe, expect, it } from 'vitest';
import { registerImportContacts } from '../../tools/import-contacts.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const ROWS = [
  { email: 'ada@example.com', firstName: 'Ada' },
  { email: 'bob@example.com', phone: '+14155550123' },
];

const OK_BODY = { created: 2, updated: 0, skipped: 0, invalid: 0, errors: [], duplicates: [] };

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('import_contacts', () => {
  it('refuses when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerImportContacts,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'import_contacts',
      arguments: { contacts: ROWS },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('refuses duplicateStrategy "update" without confirm, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerImportContacts, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'import_contacts',
      arguments: { contacts: ROWS, duplicateStrategy: 'update' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('confirm: true');
    expect(text(result)).toContain('changes existing contacts');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('refuses duplicateStrategy "update" when confirm is false, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerImportContacts, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'import_contacts',
      arguments: { contacts: ROWS, duplicateStrategy: 'update', confirm: false },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('imports in skip mode without confirm, and sends exactly the body the API takes', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/contacts/import', body: OK_BODY }]);
    const client = await connectTool(registerImportContacts, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'import_contacts',
      arguments: { contacts: ROWS, duplicateStrategy: 'skip' },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'POST', path: '/v1/contacts/import' });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    expect(api.calls[0].body).toEqual({
      contacts: ROWS,
      duplicateStrategy: 'skip',
    });
    expect(result.structuredContent).toEqual({
      created: 2,
      updated: 0,
      skipped: 0,
      invalid: 0,
      errors: [],
    });
    await client.close();
  });

  it('defaults to skip when duplicateStrategy is omitted, and forwards topicIds and sesValidation', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/contacts/import', body: OK_BODY }]);
    const client = await connectTool(registerImportContacts, makeApiConfig({ writeEnabled: true }));

    await client.callTool({
      name: 'import_contacts',
      arguments: {
        contacts: ROWS,
        topicIds: ['topic_1'],
        sesValidation: { awsAccountId: 'acct_1' },
      },
    });

    expect(api.calls[0].body).toEqual({
      contacts: ROWS,
      topicIds: ['topic_1'],
      duplicateStrategy: 'skip',
      sesValidation: { awsAccountId: 'acct_1' },
    });
    await client.close();
  });

  it('sends duplicateStrategy "update" when confirm is true, and never sends confirm to the API', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/contacts/import',
        body: { created: 0, updated: 2, skipped: 0, invalid: 0, errors: [], duplicates: [] },
      },
    ]);
    const client = await connectTool(registerImportContacts, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'import_contacts',
      arguments: { contacts: ROWS, duplicateStrategy: 'update', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].body).toEqual({ contacts: ROWS, duplicateStrategy: 'update' });
    expect(api.calls[0].body).not.toHaveProperty('confirm');
    expect(result.structuredContent).toMatchObject({ updated: 2 });
    await client.close();
  });

  it('prints at most 20 row errors in the text, says how many more there are, and keeps all in structuredContent', async () => {
    const errors = Array.from({ length: 25 }, (_, i) => ({
      row: i + 1,
      error: `Invalid email: row${i + 1}`,
    }));
    mockApi([
      {
        method: 'POST',
        path: '/v1/contacts/import',
        body: { created: 0, updated: 0, skipped: 0, invalid: 25, errors, duplicates: [] },
      },
    ]);
    const client = await connectTool(registerImportContacts, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'import_contacts',
      arguments: { contacts: Array.from({ length: 25 }, () => ({ email: 'x' })) },
    });

    const printed = text(result);
    expect(printed).toContain('- row 20: Invalid email: row20');
    expect(printed).not.toContain('- row 21:');
    expect(printed).toContain('...and 5 more');
    expect(result.structuredContent).toMatchObject({ invalid: 25 });
    expect((result.structuredContent as { errors: unknown[] }).errors).toHaveLength(25);
    await client.close();
  });

  it('refuses more than 10,000 rows before sending anything', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerImportContacts, makeApiConfig({ writeEnabled: true }));

    let refused: { isError: boolean } | { thrown: string };
    try {
      const result = await client.callTool({
        name: 'import_contacts',
        arguments: { contacts: Array.from({ length: 10_001 }, () => ({ email: 'x@example.com' })) },
      });
      refused = { isError: result.isError === true };
    } catch (err) {
      refused = { thrown: err instanceof Error ? err.message : String(err) };
    }

    expect('thrown' in refused || refused.isError === true).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('is annotated as a write and points the agent at confirm for update', async () => {
    const client = await connectTool(registerImportContacts, makeApiConfig({ writeEnabled: true }));

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'import_contacts');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false });
    expect(tool?.description).toMatch(/Pagination:/);
    expect(tool?.description).toMatch(/Truncation:/);
    expect(tool?.description).toMatch(/update.*confirm: true/);
    expect(tool?.description).toMatch(/changes/);
    await client.close();
  });
});
