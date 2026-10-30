import { describe, expect, it } from 'vitest';
import { registerSetDefaultBrandKit } from '../../tools/set-default-brand-kit.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const NOW_DEFAULT = {
  id: 'bk_2',
  organizationId: 'org_1',
  name: 'Acme Sub-brand',
  logoUrl: null,
  primaryColor: '#112233',
  secondaryColor: '#445566',
  backgroundColor: '#ffffff',
  textColor: '#000000',
  fontFamily: 'Inter',
  headingFontFamily: null,
  buttonStyle: 'rounded',
  buttonRadius: '4px',
  companyName: null,
  companyAddress: null,
  socialLinks: [],
  sourceDomain: null,
  autoExtracted: false,
  isDefault: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
};

describe('set_default_brand_kit', () => {
  it('posts to the default route for the kit and returns it as the new default', async () => {
    const api = mockApi([
      { method: 'POST', path: '/v1/brand-kits/bk_2/default', body: NOW_DEFAULT },
    ]);
    const client = await connectTool(
      registerSetDefaultBrandKit,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'set_default_brand_kit',
      arguments: { id: 'bk_2' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: 'bk_2', isDefault: true });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/brand-kits/bk_2/default',
      query: {},
    });
    expect(api.calls[0].body).toBeUndefined();
    await client.close();
  });

  it('percent-encodes the id in the path so it cannot change the route', async () => {
    const api = mockApi([
      { method: 'POST', path: '/v1/brand-kits/a%2Fb%20c/default', body: NOW_DEFAULT },
    ]);
    const client = await connectTool(
      registerSetDefaultBrandKit,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'set_default_brand_kit',
      arguments: { id: 'a/b c' },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].path).toBe('/v1/brand-kits/a%2Fb%20c/default');
    await client.close();
  });

  it('maps a kit missing in this org (404) to a tool error that says to check the id', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/brand-kits/bk_gone/default',
        status: 404,
        body: { error: 'Brand kit not found' },
      },
    ]);
    const client = await connectTool(
      registerSetDefaultBrandKit,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'set_default_brand_kit',
      arguments: { id: 'bk_gone' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Not found in this organization');
    expect(text).toContain('Brand kit not found');
    expect(text).toContain('list tool');
    await client.close();
  });

  it('refuses when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerSetDefaultBrandKit,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'set_default_brand_kit',
      arguments: { id: 'bk_2' },
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
      registerSetDefaultBrandKit,
      makeApiConfig({ writeEnabled: true, api: null })
    );

    const result = await client.callTool({
      name: 'set_default_brand_kit',
      arguments: { id: 'bk_2' },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('is a non-destructive single-record write with no confirm argument', async () => {
    const client = await connectTool(
      registerSetDefaultBrandKit,
      makeApiConfig({ writeEnabled: true })
    );

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'set_default_brand_kit');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(tool?.inputSchema.properties).not.toHaveProperty('confirm');
    expect(tool?.description).toMatch(/single record/);
    expect(tool?.description).toMatch(/hasMore/);
    await client.close();
  });
});
