import { describe, expect, it } from 'vitest';
import { registerExportContacts } from '../../tools/export-contacts.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function contact(i: number) {
  return {
    id: `c_${i}`,
    email: `user${i}@example.com`,
    phone: null,
    firstName: null,
    lastName: null,
    company: null,
    jobTitle: null,
    emailStatus: 'active',
    emailLastSoftBouncedAt: null,
    emailSoftBounceCount: 0,
    smsStatus: null,
    properties: {},
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    topics: [],
  };
}

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('export_contacts', () => {
  it('calls the JSON form of the export with the filters, and returns the rows', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/contacts/export',
        query: { format: 'json', search: 'ada', emailStatus: 'bounced', topicId: 'topic_1' },
        body: { contacts: [contact(1)], total: 1, truncated: false },
      },
    ]);
    const client = await connectTool(registerExportContacts, makeApiConfig());

    const result = await client.callTool({
      name: 'export_contacts',
      arguments: { search: 'ada', emailStatus: 'bounced', topicId: 'topic_1' },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].query).toMatchObject({ format: 'json' });
    expect(api.calls[0].query).toMatchObject({
      search: 'ada',
      emailStatus: 'bounced',
      topicId: 'topic_1',
    });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    expect(result.structuredContent).toMatchObject({
      total: 1,
      returned: 1,
      truncated: false,
      contacts: [{ id: 'c_1', email: 'user1@example.com' }],
    });
    expect(text(result)).toContain('Exported 1 of 1');
    await client.close();
  });

  it('caps the rows at 1,000 when more match, keeps total, and reports truncated true', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => contact(i));
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/contacts/export',
        body: { contacts: rows, total: 1200, truncated: false },
      },
    ]);
    const client = await connectTool(registerExportContacts, makeApiConfig());

    const result = await client.callTool({ name: 'export_contacts', arguments: {} });

    expect(api.calls).toHaveLength(1);
    const structured = result.structuredContent as {
      contacts: unknown[];
      total: number;
      returned: number;
      truncated: boolean;
    };
    expect(structured.contacts).toHaveLength(1000);
    expect(structured.returned).toBe(1000);
    expect(structured.total).toBe(1200);
    expect(structured.truncated).toBe(true);
    expect(text(result)).toContain('Truncated:');
    expect(text(result)).toContain('200 matching contact(s) are not in this result');
    await client.close();
  });

  it('propagates the API truncated flag even when the rows it returned fit', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/contacts/export',
        body: { contacts: [contact(1), contact(2)], total: 60_000, truncated: true },
      },
    ]);
    const client = await connectTool(registerExportContacts, makeApiConfig());

    const result = await client.callTool({ name: 'export_contacts', arguments: {} });

    expect(result.structuredContent).toMatchObject({
      total: 60_000,
      returned: 2,
      truncated: true,
    });
    expect(text(result)).toContain('50000 matching rows');
    await client.close();
  });

  it('reports no truncation when every match came back', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/contacts/export',
        body: { contacts: [contact(1), contact(2)], total: 2, truncated: false },
      },
    ]);
    const client = await connectTool(registerExportContacts, makeApiConfig());

    const result = await client.callTool({ name: 'export_contacts', arguments: {} });

    expect(result.structuredContent).toMatchObject({ total: 2, returned: 2, truncated: false });
    expect(text(result)).not.toContain('Truncated:');
    await client.close();
  });

  it('is read-only, and its description states the cap, the truncation rule and that there is no paging', async () => {
    const client = await connectTool(registerExportContacts, makeApiConfig());

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'export_contacts');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool?.description).toMatch(/Pagination: none/);
    expect(tool?.description).toMatch(/Truncation:/);
    expect(tool?.description).toMatch(/at most 1000 rows/);
    expect(tool?.description).toMatch(/narrow the filters/);
    await client.close();
  });
});
