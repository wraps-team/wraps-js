import { describe, expect, it } from 'vitest';
import { registerDeleteTemplate } from '../../tools/delete-template.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('delete_template', () => {
  it('refuses when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerDeleteTemplate,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'delete_template',
      arguments: { ids: ['tpl_1'], confirm: true },
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
    const client = await connectTool(registerDeleteTemplate, makeApiConfig({ writeEnabled: true }));

    let refused: { isError: boolean; text: string } | { thrown: string };
    try {
      const result = await client.callTool({
        name: 'delete_template',
        arguments: { ids: ['tpl_1'], ...extra },
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

  it('deletes one template through the single route with confirm=true', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: '/v1/templates/tpl_1',
        query: { confirm: 'true' },
        body: { success: true, id: 'tpl_1' },
      },
    ]);
    const client = await connectTool(registerDeleteTemplate, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_template',
      arguments: { ids: ['tpl_1'], confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ deleted: ['tpl_1'], notFound: [] });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'DELETE',
      path: '/v1/templates/tpl_1',
      query: { confirm: 'true' },
    });
    expect(api.calls[0].body).toBeUndefined();
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    await client.close();
  });

  it('deletes several templates through the bulk route and reports notFound', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: '/v1/templates',
        query: { confirm: 'true' },
        body: { deleted: 2, notFound: ['tpl_missing'] },
      },
    ]);
    const client = await connectTool(registerDeleteTemplate, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_template',
      arguments: { ids: ['tpl_a', 'tpl_missing', 'tpl_b'], confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      deleted: ['tpl_a', 'tpl_b'],
      notFound: ['tpl_missing'],
    });
    expect(text(result)).toContain('tpl_missing');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'DELETE',
      path: '/v1/templates',
      query: { confirm: 'true' },
      body: { ids: ['tpl_a', 'tpl_missing', 'tpl_b'] },
    });
    await client.close();
  });

  it('surfaces a 409 as an error with the API message, and nothing is deleted', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: '/v1/templates',
        query: { confirm: 'true' },
        status: 409,
        body: {
          error:
            'Cannot delete: still in use by broadcast "Launch" (scheduled). Nothing was deleted. Wait for or cancel the broadcasts, or disable the workflows and remove the template from their steps, then retry.',
          blockingIds: ['tpl_b'],
        },
      },
    ]);
    const client = await connectTool(registerDeleteTemplate, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'delete_template',
      arguments: { ids: ['tpl_a', 'tpl_b'], confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('still in use by broadcast "Launch" (scheduled)');
    expect(text(result)).toContain('Nothing was deleted');
    expect(result.structuredContent).toBeUndefined();
    expect(api.calls).toHaveLength(1);
    await client.close();
  });

  it('is destructive and states its gates in the description', async () => {
    mockApi([]);
    const client = await connectTool(registerDeleteTemplate, makeApiConfig({ writeEnabled: true }));

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'delete_template');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.description).toMatch(/Requires confirm: true/);
    expect(tool?.description).toMatch(/Requires WRAPS_WRITE_ENABLED=true/);
    expect(tool?.description).toContain('list_templates');
    await client.close();
  });
});
