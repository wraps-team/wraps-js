import { describe, expect, it } from 'vitest';
import { registerRemoveSuppression } from '../../tools/remove-suppression.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const EMAIL = 'jo+news@example.com';
const ENCODED_PATH = '/v1/suppressions/jo%2Bnews%40example.com';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('remove_suppression', () => {
  it('removes the address from the given account and pins the request sent', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: ENCODED_PATH,
        query: { awsAccountId: 'aws_1', confirm: 'true' },
        body: { success: true, email: EMAIL, wasPresent: true },
      },
    ]);
    const client = await connectTool(
      registerRemoveSuppression,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'remove_suppression',
      arguments: { email: EMAIL, awsAccountId: 'aws_1', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      id: EMAIL,
      email: EMAIL,
      success: true,
      wasPresent: true,
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'DELETE',
      path: ENCODED_PATH,
      query: { awsAccountId: 'aws_1', confirm: 'true' },
    });
    expect(api.calls[0].query).not.toHaveProperty('acknowledgedComplaint');
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    await client.close();
  });

  it('is a single-record call with no pagination: one request, no cursor sent', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: ENCODED_PATH,
        query: { awsAccountId: 'aws_1', confirm: 'true' },
        body: { success: true, email: EMAIL, wasPresent: false },
      },
    ]);
    const client = await connectTool(
      registerRemoveSuppression,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'remove_suppression',
      arguments: { email: EMAIL, awsAccountId: 'aws_1', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ wasPresent: false });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].query).not.toHaveProperty('cursor');
    await client.close();
  });

  it('sends acknowledgedComplaint=true when the user acknowledged a complaint suppression', async () => {
    const api = mockApi([
      {
        method: 'DELETE',
        path: ENCODED_PATH,
        query: { awsAccountId: 'aws_1', confirm: 'true', acknowledgedComplaint: 'true' },
        body: { success: true, email: EMAIL, wasPresent: true },
      },
    ]);
    const client = await connectTool(
      registerRemoveSuppression,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'remove_suppression',
      arguments: {
        email: EMAIL,
        awsAccountId: 'aws_1',
        acknowledgedComplaint: true,
        confirm: true,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].query).toMatchObject({ acknowledgedComplaint: 'true' });
    await client.close();
  });

  it('maps a complaint suppression refused with 409 to a tool error that names the fix', async () => {
    mockApi([
      {
        method: 'DELETE',
        path: ENCODED_PATH,
        query: { awsAccountId: 'aws_1', confirm: 'true' },
        status: 409,
        body: {
          error:
            'This address was suppressed because of a spam complaint. Confirm you understand before removing it.',
        },
      },
    ]);
    const client = await connectTool(
      registerRemoveSuppression,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'remove_suppression',
      arguments: { email: EMAIL, awsAccountId: 'aws_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Conflict');
    expect(text(result)).toContain('spam complaint');
    await client.close();
  });

  it('maps an unknown AWS account (404) to a tool error that names the id to check', async () => {
    mockApi([
      {
        method: 'DELETE',
        path: ENCODED_PATH,
        query: { awsAccountId: 'aws_missing', confirm: 'true' },
        status: 404,
        body: { error: 'AWS account not found' },
      },
    ]);
    const client = await connectTool(
      registerRemoveSuppression,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'remove_suppression',
      arguments: { email: EMAIL, awsAccountId: 'aws_missing', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('AWS account not found');
    await client.close();
  });

  it('refuses when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerRemoveSuppression,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'remove_suppression',
      arguments: { email: EMAIL, awsAccountId: 'aws_1', confirm: true },
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
    const client = await connectTool(
      registerRemoveSuppression,
      makeApiConfig({ writeEnabled: true })
    );

    let refused: { isError: boolean; text: string } | { thrown: string };
    try {
      const result = await client.callTool({
        name: 'remove_suppression',
        arguments: { email: EMAIL, awsAccountId: 'aws_1', ...extra },
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
      registerRemoveSuppression,
      makeApiConfig({ writeEnabled: true, api: null })
    );

    const result = await client.callTool({
      name: 'remove_suppression',
      arguments: { email: EMAIL, awsAccountId: 'aws_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('is annotated destructive, requires confirm: true, and points to list_suppressions for lookup', async () => {
    const client = await connectTool(
      registerRemoveSuppression,
      makeApiConfig({ writeEnabled: true })
    );

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'remove_suppression');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.description).toMatch(/Requires confirm: true/);
    expect(tool?.description).toContain('list_suppressions');
    await client.close();
  });
});
