import { describe, expect, it } from 'vitest';
import { registerCreateTemplate } from '../../tools/create-template.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const NEW_ID = '11111111-2222-4333-8444-555555555555';

const CREATED = {
  id: NEW_ID,
  name: 'Welcome',
  description: null,
  subject: 'Welcome aboard',
  previewText: null,
  emailType: 'marketing',
  channel: 'email',
  status: 'DRAFT',
  slug: 'welcome',
  publishedAt: null,
  createdAt: '2026-10-29T10:00:00.000Z',
  updatedAt: '2026-10-29T10:00:00.000Z',
  sourceHash: null,
  variables: [],
  lastEditedFrom: 'api',
  source: null,
  compiledHtml: '<html>welcome</html>',
  compiledText: null,
};

const ARGS = {
  name: 'Welcome',
  slug: 'welcome',
  subject: 'Welcome aboard',
  compiledHtml: '<html>welcome</html>',
};

describe('create_template', () => {
  it('creates a DRAFT with the body sent as given and returns the new record', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/templates', status: 201, body: CREATED }]);
    const client = await connectTool(registerCreateTemplate, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({ name: 'create_template', arguments: ARGS });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: NEW_ID,
      status: 'DRAFT',
      publishedAt: null,
      compiledHtml: '<html>welcome</html>',
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/templates');
    expect(api.calls[0].body).toEqual(ARGS);
  });

  it('refuses when writes are disabled and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerCreateTemplate,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({ name: 'create_template', arguments: ARGS });

    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses a malformed slug before any request is sent', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerCreateTemplate, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'create_template',
      arguments: { name: 'Welcome', slug: 'Not A Slug' },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('maps an API 409 (slug already taken) to a conflict tool error', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/templates',
        status: 409,
        body: { error: 'conflict', message: 'slug already exists' },
      },
    ]);
    const client = await connectTool(registerCreateTemplate, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({ name: 'create_template', arguments: ARGS });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('Conflict');
    expect(text).toContain('Read it again');
  });
});
