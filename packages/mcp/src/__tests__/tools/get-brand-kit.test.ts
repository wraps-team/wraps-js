import { describe, expect, it } from 'vitest';
import { registerGetBrandKit } from '../../tools/get-brand-kit.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const KIT = {
  id: 'bk_1',
  organizationId: 'org_1',
  name: 'Acme',
  logoUrl: null,
  primaryColor: '#112233',
  secondaryColor: '#445566',
  backgroundColor: '#ffffff',
  textColor: '#000000',
  fontFamily: 'Inter',
  headingFontFamily: 'Georgia',
  buttonStyle: 'square',
  buttonRadius: '0px',
  companyName: 'Acme Inc',
  companyAddress: '1 Main St',
  socialLinks: [{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }],
  sourceDomain: null,
  autoExtracted: true,
  isDefault: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

describe('get_brand_kit', () => {
  it('returns the single kit with its fields and pins the path sent', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/brand-kits/bk_1', body: KIT }]);
    const client = await connectTool(registerGetBrandKit, makeApiConfig());

    const result = await client.callTool({ name: 'get_brand_kit', arguments: { id: 'bk_1' } });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: 'bk_1',
      name: 'Acme',
      headingFontFamily: 'Georgia',
      buttonStyle: 'square',
      autoExtracted: true,
      isDefault: false,
      socialLinks: [{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }],
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/v1/brand-kits/bk_1', query: {} });
    await client.close();
  });

  it('percent-encodes the id in the path so it cannot change the route', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/brand-kits/a%2Fb%20c', body: KIT }]);
    const client = await connectTool(registerGetBrandKit, makeApiConfig());

    const result = await client.callTool({ name: 'get_brand_kit', arguments: { id: 'a/b c' } });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].path).toBe('/v1/brand-kits/a%2Fb%20c');
    await client.close();
  });

  it('maps a missing kit (404) to a tool error that says to check the id', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/brand-kits/bk_gone',
        status: 404,
        body: { error: 'Brand kit not found' },
      },
    ]);
    const client = await connectTool(registerGetBrandKit, makeApiConfig());

    const result = await client.callTool({ name: 'get_brand_kit', arguments: { id: 'bk_gone' } });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Not found in this organization');
    expect(text).toContain('Brand kit not found');
    expect(text).toContain('list tool');
    await client.close();
  });

  it('is annotated read-only and its description states that it returns a single record', async () => {
    const client = await connectTool(registerGetBrandKit, makeApiConfig());

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'get_brand_kit');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(tool?.description).toMatch(/single record/);
    expect(tool?.description).toMatch(/hasMore/);
    await client.close();
  });
});
