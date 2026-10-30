import { describe, expect, it } from 'vitest';
import { registerDeleteBrandKit } from '../../tools/delete-brand-kit.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('delete_brand_kit', () => {
  it('deletes the kit with confirm=true in the query and returns the deleted id', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: '/v1/brand-kits/bk_1',
        query: { confirm: 'true' },
        body: { success: true },
      },
    ]);
    const client = await connectTool(registerDeleteBrandKit, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_brand_kit',
      arguments: { id: 'bk_1', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ id: 'bk_1', success: true });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'DELETE',
      path: '/v1/brand-kits/bk_1',
      query: { confirm: 'true' },
    });
    expect(api.calls[0].body).toBeUndefined();
    await client.close();
  });

  it('percent-encodes the id in the path so it cannot change the route', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: '/v1/brand-kits/a%2Fb%20c',
        query: { confirm: 'true' },
        body: { success: true },
      },
    ]);
    const client = await connectTool(registerDeleteBrandKit, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_brand_kit',
      arguments: { id: 'a/b c', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].path).toBe('/v1/brand-kits/a%2Fb%20c');
    await client.close();
  });

  it('maps a kit missing in this org (404) to a tool error that says to check the id', async () => {
    mockApi([
      {
        method: 'DELETE',
        path: '/v1/brand-kits/bk_gone',
        query: { confirm: 'true' },
        status: 404,
        body: { error: 'Brand kit not found' },
      },
    ]);
    const client = await connectTool(registerDeleteBrandKit, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_brand_kit',
      arguments: { id: 'bk_gone', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('Brand kit not found');
    expect(text(result)).toContain('list tool');
    await client.close();
  });

  it('refuses when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerDeleteBrandKit,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'delete_brand_kit',
      arguments: { id: 'bk_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it.each([
    ['missing', {}],
    ['false', { confirm: false }],
    ['the string "true"', { confirm: 'true' }],
  ])('refuses when confirm is %s, and sends no request', async (_label, extra) => {
    const api = mockApi([]);
    const client = await connectTool(registerDeleteBrandKit, makeApiConfig({ writeEnabled: true }));

    let refused: { isError: boolean; text: string } | { thrown: string };
    try {
      const result = await client.callTool({
        name: 'delete_brand_kit',
        arguments: { id: 'bk_1', ...extra },
      });
      refused = { isError: result.isError === true, text: text(result) };
    } catch (err) {
      refused = { thrown: err instanceof Error ? err.message : String(err) };
    }

    expect(refused).toMatchObject({ isError: true });
    expect((refused as { text: string }).text).toContain('confirm must be true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('refuses without sending a request when no Wraps credential is configured', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerDeleteBrandKit,
      makeApiConfig({ writeEnabled: true, api: null })
    );

    const result = await client.callTool({
      name: 'delete_brand_kit',
      arguments: { id: 'bk_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('is annotated destructive, requires confirm: true, and says it is irreversible', async () => {
    const client = await connectTool(registerDeleteBrandKit, makeApiConfig({ writeEnabled: true }));

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'delete_brand_kit');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.description).toMatch(/Requires confirm: true/);
    expect(tool?.description).toMatch(/Irreversible/);
    await client.close();
  });
});
