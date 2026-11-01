import { describe, expect, it } from 'vitest';
import { registerAddSuppression } from '../../tools/add-suppression.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const EMAIL = 'jo+news@example.com';
const OTHER = 'sam@example.com';
const BAD = 'not-an-address';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('add_suppression', () => {
  it('adds one address through the single route and pins the request sent', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/suppressions',
        // The mock's `body` is the API's response.
        body: { success: true, email: EMAIL, awsAccountId: 'aws_1', alreadyPresent: false },
      },
    ]);
    const client = await connectTool(registerAddSuppression, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'add_suppression',
      arguments: { emails: [EMAIL], awsAccountId: 'aws_1', reason: 'BOUNCE', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      awsAccountId: 'aws_1',
      reason: 'BOUNCE',
      results: [{ email: EMAIL, success: true, alreadyPresent: false }],
      added: 1,
      alreadyPresent: 0,
      failed: 0,
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'POST', path: '/v1/suppressions' });
    expect(api.calls[0].body).toEqual({ awsAccountId: 'aws_1', email: EMAIL, reason: 'BOUNCE' });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    await client.close();
  });

  it('sends one bulk request for several addresses and reports mixed per-address results', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/suppressions/bulk',
        body: {
          results: [
            { email: EMAIL, success: true, alreadyPresent: false },
            { email: OTHER, success: true, alreadyPresent: true },
            { email: BAD, success: false, error: 'Enter a valid email address.' },
          ],
        },
      },
    ]);
    const client = await connectTool(registerAddSuppression, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'add_suppression',
      arguments: {
        emails: [EMAIL, OTHER, BAD],
        awsAccountId: 'aws_1',
        reason: 'COMPLAINT',
        confirm: true,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      awsAccountId: 'aws_1',
      reason: 'COMPLAINT',
      results: [
        { email: EMAIL, success: true, alreadyPresent: false },
        { email: OTHER, success: true, alreadyPresent: true },
        { email: BAD, success: false, error: 'Enter a valid email address.' },
      ],
      added: 1,
      alreadyPresent: 1,
      failed: 1,
    });
    expect(text(result)).toContain(`${BAD}: Enter a valid email address.`);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].path).toBe('/v1/suppressions/bulk');
    expect(api.calls[0].body).toEqual({
      entries: [
        { awsAccountId: 'aws_1', email: EMAIL, reason: 'COMPLAINT' },
        { awsAccountId: 'aws_1', email: OTHER, reason: 'COMPLAINT' },
        { awsAccountId: 'aws_1', email: BAD, reason: 'COMPLAINT' },
      ],
    });
    await client.close();
  });

  it('is an error when every bulk address failed, and says what failed', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/suppressions/bulk',
        body: {
          results: [
            { email: EMAIL, success: false, error: 'AWS account not found' },
            { email: OTHER, success: false, error: 'AWS account not found' },
          ],
        },
      },
    ]);
    const client = await connectTool(registerAddSuppression, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'add_suppression',
      arguments: { emails: [EMAIL, OTHER], awsAccountId: 'aws_1', reason: 'BOUNCE', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ added: 0, alreadyPresent: 0, failed: 2 });
    expect(text(result)).toContain('AWS account not found');
    await client.close();
  });

  it('maps an unknown AWS account on the single route (404) to a tool error that names the id to check', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/suppressions',
        status: 404,
        body: { error: 'AWS account not found' },
      },
    ]);
    const client = await connectTool(registerAddSuppression, makeApiConfig({ writeEnabled: true }));

    const result = await client.callTool({
      name: 'add_suppression',
      arguments: { emails: [EMAIL], awsAccountId: 'aws_missing', reason: 'BOUNCE', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('AWS account not found');
    expect(api.calls).toHaveLength(1);
    await client.close();
  });

  it('refuses when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerAddSuppression,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'add_suppression',
      arguments: { emails: [EMAIL], awsAccountId: 'aws_1', reason: 'BOUNCE', confirm: true },
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
    const client = await connectTool(registerAddSuppression, makeApiConfig({ writeEnabled: true }));

    let refused: { isError: boolean; text: string } | { thrown: string };
    try {
      const result = await client.callTool({
        name: 'add_suppression',
        arguments: { emails: [EMAIL], awsAccountId: 'aws_1', reason: 'BOUNCE', ...extra },
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
      registerAddSuppression,
      makeApiConfig({ writeEnabled: true, api: null })
    );

    const result = await client.callTool({
      name: 'add_suppression',
      arguments: { emails: [EMAIL], awsAccountId: 'aws_1', reason: 'BOUNCE', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('is annotated destructive, requires confirm: true, and names remove_suppression as the undo', async () => {
    const client = await connectTool(registerAddSuppression, makeApiConfig({ writeEnabled: true }));

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'add_suppression');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.description).toMatch(/Requires confirm: true/);
    expect(tool?.description).toContain('remove_suppression');
    await client.close();
  });
});
