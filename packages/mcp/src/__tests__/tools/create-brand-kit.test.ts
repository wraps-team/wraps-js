import { describe, expect, it } from 'vitest';
import { registerCreateBrandKit } from '../../tools/create-brand-kit.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const CREATED = {
  id: 'bk_new',
  organizationId: 'org_1',
  name: 'Acme',
  logoUrl: 'https://cdn.example.com/acme.png',
  primaryColor: '#112233',
  secondaryColor: '#445566',
  backgroundColor: '#ffffff',
  textColor: '#000000',
  fontFamily: 'Inter',
  headingFontFamily: null,
  buttonStyle: 'pill',
  buttonRadius: '8px',
  companyName: 'Acme Inc',
  companyAddress: null,
  socialLinks: [{ platform: 'x', url: 'https://x.com/acme' }],
  sourceDomain: null,
  autoExtracted: false,
  isDefault: true,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
};

describe('create_brand_kit', () => {
  it('posts only the fields passed and returns the created record', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/brand-kits', status: 201, body: CREATED }]);
    const client = await connectTool(registerCreateBrandKit, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'create_brand_kit',
      arguments: {
        name: 'Acme',
        primaryColor: '#112233',
        buttonStyle: 'pill',
        socialLinks: [{ platform: 'x', url: 'https://x.com/acme' }],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: 'bk_new',
      name: 'Acme',
      isDefault: true,
      socialLinks: [{ platform: 'x', url: 'https://x.com/acme' }],
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/brand-kits',
      query: {},
      body: {
        name: 'Acme',
        primaryColor: '#112233',
        buttonStyle: 'pill',
        socialLinks: [{ platform: 'x', url: 'https://x.com/acme' }],
      },
    });
    expect(api.calls[0].body).not.toHaveProperty('id');
    await client.close();
  });

  it('passes isDefault through so the new kit can replace the current default', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/brand-kits', status: 201, body: CREATED }]);
    const client = await connectTool(registerCreateBrandKit, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'create_brand_kit',
      arguments: { name: 'Acme', isDefault: true },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].body).toMatchObject({ name: 'Acme', isDefault: true });
    await client.close();
  });

  it('maps a refused social link (400) to a tool error that says to fix the arguments', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/brand-kits',
        status: 400,
        body: { error: 'socialLinks entries need a non-empty platform and url' },
      },
    ]);
    const client = await connectTool(registerCreateBrandKit, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'create_brand_kit',
      arguments: { name: 'Acme', socialLinks: [{ platform: '', url: 'https://x.com/acme' }] },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('The Wraps API rejected the request');
    expect(text).toContain('socialLinks entries need a non-empty platform and url');
    expect(text).toContain('Fix the arguments and retry');
    await client.close();
  });

  it('refuses when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerCreateBrandKit,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'create_brand_kit',
      arguments: { name: 'Acme' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('refuses without sending a request when no Wraps credential is configured', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerCreateBrandKit,
      makeApiConfig({ writeEnabled: true, api: null })
    );

    const result = await client.callTool({
      name: 'create_brand_kit',
      arguments: { name: 'Acme' },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('is a single-record write: annotated non-destructive, no confirm argument, and says so', async () => {
    const client = await connectTool(registerCreateBrandKit, makeApiConfig({ writeEnabled: true }));

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'create_brand_kit');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(tool?.inputSchema.properties).not.toHaveProperty('confirm');
    expect(tool?.description).toMatch(/single created record/);
    expect(tool?.description).toMatch(/hasMore/);
    await client.close();
  });
});
