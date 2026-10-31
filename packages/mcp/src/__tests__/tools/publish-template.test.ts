import { describe, expect, it } from 'vitest';
import { registerPublishTemplate } from '../../tools/publish-template.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const TEMPLATE_ID = '11111111-2222-4333-8444-555555555555';
const AWS_ACCOUNT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const PUBLISHED = {
  success: true,
  sesTemplateName: 'wraps-email-welcome-1111',
  publishedAt: '2026-10-29T16:00:00.000Z',
};

describe('publish_template', () => {
  it('publishes with confirm: true and returns the SES template name and publish time', async () => {
    const api = mockApi([
      { method: 'POST', path: `/v1/templates/${TEMPLATE_ID}/publish`, body: PUBLISHED },
    ]);
    const client = await connectTool(
      registerPublishTemplate,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'publish_template',
      arguments: { id: TEMPLATE_ID, confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      id: TEMPLATE_ID,
      ...PUBLISHED,
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe(`/v1/templates/${TEMPLATE_ID}/publish`);
    expect(api.calls[0].body).toBeUndefined();
  });

  it('sends the awsAccountId in the body when given', async () => {
    const api = mockApi([
      { method: 'POST', path: `/v1/templates/${TEMPLATE_ID}/publish`, body: PUBLISHED },
    ]);
    const client = await connectTool(
      registerPublishTemplate,
      makeApiConfig({ writeEnabled: true })
    );

    await client.callTool({
      name: 'publish_template',
      arguments: { id: TEMPLATE_ID, awsAccountId: AWS_ACCOUNT_ID, confirm: true },
    });

    expect(api.calls[0].body).toEqual({ awsAccountId: AWS_ACCOUNT_ID });
  });

  it('refuses without confirm and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerPublishTemplate,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'publish_template',
      arguments: { id: TEMPLATE_ID },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('refuses confirm: false and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerPublishTemplate,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'publish_template',
      arguments: { id: TEMPLATE_ID, confirm: false },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('refuses when writes are disabled, even with confirm: true, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerPublishTemplate,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'publish_template',
      arguments: { id: TEMPLATE_ID, confirm: true },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
  });

  it('maps an API 400 (no subject) to a tool error that names the fix', async () => {
    mockApi([
      {
        method: 'POST',
        path: `/v1/templates/${TEMPLATE_ID}/publish`,
        status: 400,
        body: {
          error: 'Template subject is required for publishing. Please set a subject line.',
          code: 'BAD_REQUEST',
        },
      },
    ]);
    const client = await connectTool(
      registerPublishTemplate,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'publish_template',
      arguments: { id: TEMPLATE_ID, confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain('The Wraps API rejected the request');
    expect(text).toContain('Template subject is required for publishing');
  });
});
