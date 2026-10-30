import { describe, expect, it } from 'vitest';
import { registerGetTemplate } from '../../tools/get-template.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const TEMPLATE_ID = '11111111-2222-4333-8444-555555555555';

const DETAIL = {
  id: TEMPLATE_ID,
  name: 'Welcome',
  description: null,
  subject: 'Welcome aboard',
  previewText: 'Thanks for joining',
  emailType: 'transactional',
  channel: 'email',
  status: 'PUBLISHED',
  slug: 'welcome',
  publishedAt: '2026-10-01T10:00:00.000Z',
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  sourceHash: 'abc123',
  variables: [{ name: 'firstName', fallback: 'there' }],
  lastEditedFrom: 'api',
  source: 'export default function Welcome() { return null; }',
  compiledHtml: '<html>welcome</html>',
  compiledText: 'welcome',
};

describe('get_template', () => {
  it('returns the single record with its source by default', async () => {
    const api = mockApi([{ method: 'GET', path: `/v1/templates/${TEMPLATE_ID}`, body: DETAIL }]);
    const client = await connectTool(registerGetTemplate, makeApiConfig());

    const result = await client.callTool({
      name: 'get_template',
      arguments: { id: TEMPLATE_ID },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(DETAIL);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('GET');
    expect(api.calls[0].path).toBe(`/v1/templates/${TEMPLATE_ID}`);
    expect(api.calls[0].query).toEqual({});
  });

  it('sends source=false and returns no source fields when asked to omit them', async () => {
    const { source: _source, compiledHtml: _html, compiledText: _text, ...withoutSource } = DETAIL;
    const api = mockApi([
      {
        method: 'GET',
        path: `/v1/templates/${TEMPLATE_ID}`,
        query: { source: 'false' },
        body: withoutSource,
      },
    ]);
    const client = await connectTool(registerGetTemplate, makeApiConfig());

    const result = await client.callTool({
      name: 'get_template',
      arguments: { id: TEMPLATE_ID, source: false },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].query).toEqual({ source: 'false' });
    expect(result.structuredContent).toEqual(withoutSource);
    expect(result.structuredContent).not.toHaveProperty('source');
    expect(result.structuredContent).toHaveProperty('sourceHash', 'abc123');
  });

  it('maps an API 404 to a tool error that names the list tool', async () => {
    mockApi([
      {
        method: 'GET',
        path: `/v1/templates/${TEMPLATE_ID}`,
        status: 404,
        body: { error: 'Template not found', code: 'NOT_FOUND' },
      },
    ]);
    const client = await connectTool(registerGetTemplate, makeApiConfig());

    const result = await client.callTool({
      name: 'get_template',
      arguments: { id: TEMPLATE_ID },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('Not found in this organization');
    expect(text).toContain('list tool');
  });
});
