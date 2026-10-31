import { describe, expect, it } from 'vitest';
import { registerUpdateTemplate } from '../../tools/update-template.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const TEMPLATE_ID = '11111111-2222-4333-8444-555555555555';

const UPDATED = {
  id: TEMPLATE_ID,
  name: 'Welcome',
  description: null,
  subject: 'Welcome, friend',
  previewText: null,
  emailType: 'marketing',
  channel: 'email',
  status: 'DRAFT',
  slug: 'welcome',
  publishedAt: null,
  createdAt: '2026-10-29T10:00:00.000Z',
  updatedAt: '2026-10-29T12:00:00.000Z',
  sourceHash: null,
  variables: [],
  lastEditedFrom: 'api',
  source: null,
  compiledHtml: '<html>v2</html>',
  compiledText: null,
};

describe('update_template', () => {
  it('sends only the changed fields as a PATCH and returns the updated record', async () => {
    const api = mockApi([{ method: 'PATCH', path: `/v1/templates/${TEMPLATE_ID}`, body: UPDATED }]);
    const client = await connectTool(registerUpdateTemplate, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_template',
      arguments: { id: TEMPLATE_ID, subject: 'Welcome, friend', compiledHtml: '<html>v2</html>' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: TEMPLATE_ID,
      subject: 'Welcome, friend',
      status: 'DRAFT',
      compiledHtml: '<html>v2</html>',
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('PATCH');
    expect(api.calls[0].path).toBe(`/v1/templates/${TEMPLATE_ID}`);
    expect(api.calls[0].body).toEqual({
      subject: 'Welcome, friend',
      compiledHtml: '<html>v2</html>',
    });
  });

  it('passes ifUnmodifiedSince through in the body for the concurrency guard', async () => {
    const api = mockApi([{ method: 'PATCH', path: `/v1/templates/${TEMPLATE_ID}`, body: UPDATED }]);
    const client = await connectTool(registerUpdateTemplate, makeApiConfig({ writeEnabled: true }));

    await client.callTool({
      name: 'update_template',
      arguments: {
        id: TEMPLATE_ID,
        subject: 'Welcome, friend',
        ifUnmodifiedSince: '2026-10-29T11:00:00.000Z',
      },
    });

    expect(api.calls[0].body).toEqual({
      subject: 'Welcome, friend',
      ifUnmodifiedSince: '2026-10-29T11:00:00.000Z',
    });
  });

  it('refuses when writes are disabled and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerUpdateTemplate,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'update_template',
      arguments: { id: TEMPLATE_ID, subject: 'x' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses an update with no fields to change, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerUpdateTemplate, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_template',
      arguments: { id: TEMPLATE_ID },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('Nothing was changed');
    expect(api.calls).toHaveLength(0);
  });

  it('maps an API 409 (changed since ifUnmodifiedSince) to a conflict tool error', async () => {
    mockApi([
      {
        method: 'PATCH',
        path: `/v1/templates/${TEMPLATE_ID}`,
        status: 409,
        body: {
          error: 'conflict',
          message: 'Template was modified after ifUnmodifiedSince',
          lastEditedFrom: 'dashboard',
          updatedAt: '2026-10-29T12:00:00.000Z',
        },
      },
    ]);
    const client = await connectTool(registerUpdateTemplate, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_template',
      arguments: {
        id: TEMPLATE_ID,
        subject: 'x',
        ifUnmodifiedSince: '2026-10-29T11:00:00.000Z',
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('Conflict');
    expect(text).toContain('Read it again');
  });
});
