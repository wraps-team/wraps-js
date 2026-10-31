import { describe, expect, it } from 'vitest';
import { registerValidateContactEmails } from '../../tools/validate-contact-emails.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('validate_contact_emails', () => {
  it('posts the addresses to the validate route and returns one result per verdict', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/contacts/validate',
        body: {
          verdicts: { 'ada@example.com': 'HIGH', 'bob@example.com': 'LOW' },
          validatedCount: 2,
          stoppedEarly: false,
          invalid: ['not-an-email'],
        },
      },
    ]);
    const client = await connectTool(registerValidateContactEmails, makeApiConfig());

    const result = await client.callTool({
      name: 'validate_contact_emails',
      arguments: {
        awsAccountId: 'acct-1',
        emails: ['ada@example.com', 'bob@example.com', 'not-an-email'],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('POST');
    expect(api.calls[0]?.path).toBe('/v1/contacts/validate');
    expect(api.calls[0]?.body).toEqual({
      awsAccountId: 'acct-1',
      emails: ['ada@example.com', 'bob@example.com', 'not-an-email'],
    });
    expect(result.structuredContent).toEqual({
      results: [
        { id: 'ada@example.com', email: 'ada@example.com', verdict: 'HIGH' },
        { id: 'bob@example.com', email: 'bob@example.com', verdict: 'LOW' },
      ],
      invalid: ['not-an-email'],
      validatedCount: 2,
      stoppedEarly: false,
    });
    expect(text(result)).toContain('not-an-email');
    await client.close();
  });

  it('reports a throttled run with stoppedEarly so unchecked addresses are not read as verdicts', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/contacts/validate',
        body: {
          verdicts: { 'ada@example.com': 'HIGH' },
          validatedCount: 1,
          stoppedEarly: true,
          invalid: [],
        },
      },
    ]);
    const client = await connectTool(registerValidateContactEmails, makeApiConfig());

    const result = await client.callTool({
      name: 'validate_contact_emails',
      arguments: { awsAccountId: 'acct-1', emails: ['ada@example.com', 'later@example.com'] },
    });

    expect(result.structuredContent).toMatchObject({ stoppedEarly: true, validatedCount: 1 });
    expect(text(result)).toContain('throttled');
    await client.close();
  });

  it('maps a 403 to a tool error that names the role, key scope or plan fix', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/contacts/validate',
        status: 403,
        body: { error: 'Missing permission contacts:import' },
      },
    ]);
    const client = await connectTool(registerValidateContactEmails, makeApiConfig());

    const result = await client.callTool({
      name: 'validate_contact_emails',
      arguments: { awsAccountId: 'acct-1', emails: ['ada@example.com'] },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Permission denied');
    expect(text(result)).toContain('Missing permission contacts:import');
    expect(text(result)).toContain("API key's scopes");
    expect(api.calls).toHaveLength(1);
    await client.close();
  });
});
