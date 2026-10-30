import { describe, expect, it } from 'vitest';
import { registerUpdateBrandKit } from '../../tools/update-brand-kit.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const UPDATED = {
  id: 'bk_1',
  organizationId: 'org_1',
  name: 'Acme Labs',
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

describe('update_brand_kit', () => {
  it('sends only the passed fields and returns the updated record', async () => {
    const api = mockApi([{ method: 'PATCH', path: '/v1/brand-kits/bk_1', body: UPDATED }]);
    const client = await connectTool(registerUpdateBrandKit, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_brand_kit',
      arguments: { id: 'bk_1', name: 'Acme Labs', logoUrl: null, buttonStyle: 'rounded' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: 'bk_1',
      name: 'Acme Labs',
      logoUrl: null,
      buttonStyle: 'rounded',
      isDefault: true,
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'PATCH',
      path: '/v1/brand-kits/bk_1',
      query: {},
      body: { name: 'Acme Labs', logoUrl: null, buttonStyle: 'rounded' },
    });
    expect(api.calls[0].body).not.toHaveProperty('id');
    await client.close();
  });

  it('percent-encodes the id in the path so it cannot change the route', async () => {
    const api = mockApi([{ method: 'PATCH', path: '/v1/brand-kits/a%2Fb%20c', body: UPDATED }]);
    const client = await connectTool(registerUpdateBrandKit, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_brand_kit',
      arguments: { id: 'a/b c', textColor: '#111111' },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].path).toBe('/v1/brand-kits/a%2Fb%20c');
    expect(api.calls[0].body).toEqual({ textColor: '#111111' });
    await client.close();
  });

  it('refuses when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerUpdateBrandKit,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'update_brand_kit',
      arguments: { id: 'bk_1', name: 'Renamed' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('maps a blank name (400) to a tool error that says to fix the arguments', async () => {
    mockApi([
      {
        method: 'PATCH',
        path: '/v1/brand-kits/bk_1',
        status: 400,
        body: { error: 'Brand kit name cannot be blank' },
      },
    ]);
    const client = await connectTool(registerUpdateBrandKit, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_brand_kit',
      arguments: { id: 'bk_1', name: '   ' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('The Wraps API rejected the request');
    expect(text).toContain('Brand kit name cannot be blank');
    expect(text).toContain('Fix the arguments and retry');
    await client.close();
  });

  it('maps a kit missing in this org (404) to a tool error that says to check the id', async () => {
    mockApi([
      {
        method: 'PATCH',
        path: '/v1/brand-kits/bk_gone',
        status: 404,
        body: { error: 'Brand kit not found' },
      },
    ]);
    const client = await connectTool(registerUpdateBrandKit, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'update_brand_kit',
      arguments: { id: 'bk_gone', name: 'Acme' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Not found in this organization');
    expect(text).toContain('list tool');
    await client.close();
  });

  it('does not accept isDefault or autoExtracted: the set-default tool owns the default', async () => {
    const client = await connectTool(registerUpdateBrandKit, makeApiConfig({ writeEnabled: true }));

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'update_brand_kit');
    expect(tool?.inputSchema.properties).not.toHaveProperty('isDefault');
    expect(tool?.inputSchema.properties).not.toHaveProperty('autoExtracted');
    expect(tool?.description).toContain('set_default_brand_kit');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    await client.close();
  });
});
