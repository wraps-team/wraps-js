import { describe, expect, it } from 'vitest';
import { registerDuplicateTemplate } from '../../tools/duplicate-template.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const ORIGINAL_ID = '11111111-2222-4333-8444-555555555555';
const COPY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const COPY = {
  id: COPY_ID,
  name: 'Welcome (Copy)',
  description: null,
  subject: 'Welcome aboard',
  previewText: 'Thanks for joining',
  emailType: 'transactional',
  channel: 'email',
  status: 'DRAFT',
  slug: null,
  publishedAt: null,
  createdAt: '2026-10-29T10:00:00.000Z',
  updatedAt: '2026-10-29T10:00:00.000Z',
  sourceHash: 'abc123',
  variables: [],
  lastEditedFrom: 'api',
  source: 'export default function Welcome() { return null; }',
  compiledHtml: '<html>welcome</html>',
  compiledText: 'welcome',
};

describe('duplicate_template', () => {
  it('posts to the original id and returns the copy as a DRAFT with no slug or publish state', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: `/v1/templates/${ORIGINAL_ID}/duplicate`,
        status: 201,
        body: COPY,
      },
    ]);
    const client = await connectTool(
      registerDuplicateTemplate,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'duplicate_template',
      arguments: { id: ORIGINAL_ID },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: COPY_ID,
      name: 'Welcome (Copy)',
      status: 'DRAFT',
      slug: null,
      publishedAt: null,
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe(`/v1/templates/${ORIGINAL_ID}/duplicate`);
    expect(api.calls[0].body).toBeUndefined();
  });

  it('refuses when writes are disabled and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerDuplicateTemplate,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'duplicate_template',
      arguments: { id: ORIGINAL_ID },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });

  it('maps an API 404 (original not in this organization) to a tool error', async () => {
    mockApi([
      {
        method: 'POST',
        path: `/v1/templates/${ORIGINAL_ID}/duplicate`,
        status: 404,
        body: { error: 'Template not found', code: 'NOT_FOUND' },
      },
    ]);
    const client = await connectTool(
      registerDuplicateTemplate,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'duplicate_template',
      arguments: { id: ORIGINAL_ID },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('Not found in this organization');
    expect(text).toContain('Template not found');
  });
});
