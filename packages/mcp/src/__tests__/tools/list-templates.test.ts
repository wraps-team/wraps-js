import { describe, expect, it } from 'vitest';
import { registerListTemplates } from '../../tools/list-templates.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const TEMPLATE = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'Welcome',
  description: null,
  subject: 'Welcome aboard',
  previewText: null,
  emailType: 'transactional',
  channel: 'email',
  status: 'PUBLISHED',
  slug: 'welcome',
  publishedAt: '2026-10-01T10:00:00.000Z',
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

describe('list_templates', () => {
  it('lists one page with the filters passed as query parameters', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/templates',
        query: { limit: '5', status: 'PUBLISHED', channel: 'email', search: 'welcome' },
        body: { data: [TEMPLATE], nextCursor: null },
      },
    ]);
    const client = await connectTool(registerListTemplates, makeApiConfig());

    const result = await client.callTool({
      name: 'list_templates',
      arguments: { limit: 5, status: 'PUBLISHED', channel: 'email', search: 'welcome' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      templates: [TEMPLATE],
      nextCursor: null,
      hasMore: false,
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe('/v1/templates');
    expect(api.calls[0].query).toEqual({
      limit: '5',
      status: 'PUBLISHED',
      channel: 'email',
      search: 'welcome',
    });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
  });

  it('passes the cursor from nextCursor through to the next page', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/templates',
        query: {},
        body: { data: [TEMPLATE], nextCursor: 'cursor-page-2' },
      },
      {
        method: 'GET',
        path: '/v1/templates',
        query: { cursor: 'cursor-page-2' },
        body: {
          data: [{ ...TEMPLATE, id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }],
          nextCursor: null,
        },
      },
    ]);
    const client = await connectTool(registerListTemplates, makeApiConfig());

    const first = await client.callTool({ name: 'list_templates', arguments: {} });
    expect(first.structuredContent).toMatchObject({ hasMore: true, nextCursor: 'cursor-page-2' });

    const second = await client.callTool({
      name: 'list_templates',
      arguments: { cursor: 'cursor-page-2' },
    });
    expect(second.structuredContent).toMatchObject({
      hasMore: false,
      nextCursor: null,
      templates: [{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }],
    });
    expect(api.calls[1].query).toEqual({ cursor: 'cursor-page-2' });
  });

  it('maps an API 401 to an actionable tool error and returns no structured content', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/templates',
        status: 401,
        body: { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      },
    ]);
    const client = await connectTool(registerListTemplates, makeApiConfig());

    const result = await client.callTool({ name: 'list_templates', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('WRAPS_API_KEY');
    expect(text).toContain('UNAUTHORIZED');
  });

  it('refuses with the fix and sends no request when no credential is configured', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerListTemplates, makeApiConfig({ api: null }));

    const result = await client.callTool({ name: 'list_templates', arguments: {} });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});
