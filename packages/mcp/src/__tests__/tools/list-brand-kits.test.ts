import { describe, expect, it } from 'vitest';
import { registerListBrandKits } from '../../tools/list-brand-kits.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const DEFAULT_KIT = {
  id: 'bk_default',
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
  sourceDomain: 'acme.example.com',
  autoExtracted: false,
  isDefault: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

const OTHER_KIT = {
  ...DEFAULT_KIT,
  id: 'bk_other',
  name: 'Acme Sub-brand',
  logoUrl: null,
  socialLinks: [],
  sourceDomain: null,
  isDefault: false,
};

describe('list_brand_kits', () => {
  it('returns every kit with the count and pins the request sent', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/brand-kits',
        body: { brandKits: [DEFAULT_KIT, OTHER_KIT], count: 2 },
      },
    ]);
    const client = await connectTool(registerListBrandKits, makeApiConfig());

    const result = await client.callTool({ name: 'list_brand_kits', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      count: 2,
      brandKits: [
        { id: 'bk_default', name: 'Acme', isDefault: true, socialLinks: [{ platform: 'x' }] },
        { id: 'bk_other', name: 'Acme Sub-brand', isDefault: false, logoUrl: null },
      ],
    });
    expect((result.structuredContent as { brandKits: unknown[] }).brandKits).toHaveLength(2);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/v1/brand-kits', query: {} });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    await client.close();
  });

  it('is unpaginated: it sends no cursor, offset or limit, and reports an empty org as zero', async () => {
    const api = mockApi([
      { method: 'GET', path: '/v1/brand-kits', body: { brandKits: [], count: 0 } },
    ]);
    const client = await connectTool(registerListBrandKits, makeApiConfig());

    const result = await client.callTool({ name: 'list_brand_kits', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ brandKits: [], count: 0 });
    expect(api.calls[0].query).toEqual({});
    await client.close();
  });

  it('maps an API error (403, no templates write permission) to a tool error that names the fix', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/brand-kits',
        status: 403,
        body: { error: 'Missing templates:read permission' },
      },
    ]);
    const client = await connectTool(registerListBrandKits, makeApiConfig());

    const result = await client.callTool({ name: 'list_brand_kits', arguments: {} });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Permission denied');
    expect(text).toContain('Missing templates:read permission');
    expect(text).toContain('Ask an organization admin');
    await client.close();
  });

  it('is annotated read-only and its description states pagination and truncation', async () => {
    const client = await connectTool(registerListBrandKits, makeApiConfig());

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'list_brand_kits');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(tool?.description).toMatch(/Pagination: none/);
    expect(tool?.description).toMatch(/hasMore/);
    await client.close();
  });
});
