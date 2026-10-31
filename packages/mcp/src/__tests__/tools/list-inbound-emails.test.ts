import { describe, expect, it } from 'vitest';
import { registerListInboundEmails } from '../../tools/list-inbound-emails.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const EMAIL_A = {
  awsAccountId: 'acct_1',
  emailId: 'em_a1',
  from: { address: 'sender@example.com', name: 'Sender' },
  to: [{ address: 'support@acme.example', name: '' }],
  subject: 'Invoice question',
  receivedAt: '2026-10-20T09:00:00.000Z',
  hasAttachments: true,
  attachmentCount: 2,
  spamVerdict: 'PASS',
  virusVerdict: null,
};

const EMAIL_B = {
  ...EMAIL_A,
  awsAccountId: 'acct_2',
  emailId: 'em_b7',
  subject: 'Re: invoice',
  receivedAt: '2026-10-21T09:00:00.000Z',
  hasAttachments: false,
  attachmentCount: 0,
  spamVerdict: null,
};

describe('list_inbound_emails', () => {
  it('returns the first page with ids, cursor and skipped accounts, and pins the request sent', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/email/inbound',
        body: {
          data: [EMAIL_A, EMAIL_B],
          nextCursor: 'cur_page2',
          deniedAccountIds: ['acct_9'],
          unreachableAccountIds: [],
        },
      },
    ]);
    const client = await connectTool(registerListInboundEmails, makeApiConfig());

    const result = await client.callTool({ name: 'list_inbound_emails', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      emails: [
        { id: 'em_a1', emailId: 'em_a1', awsAccountId: 'acct_1', attachmentCount: 2 },
        { id: 'em_b7', emailId: 'em_b7', awsAccountId: 'acct_2', hasAttachments: false },
      ],
      nextCursor: 'cur_page2',
      deniedAccountIds: ['acct_9'],
      unreachableAccountIds: [],
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/v1/email/inbound', query: {} });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('call again with cursor set to nextCursor (cur_page2)');
    expect(text).toContain('Skipped accounts that denied access: acct_9');
    await client.close();
  });

  it('continues pagination by sending the cursor back, including after an empty page', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/email/inbound',
        query: { cursor: 'cur_page2' },
        body: {
          data: [EMAIL_B],
          nextCursor: null,
          deniedAccountIds: [],
          unreachableAccountIds: [],
        },
      },
      {
        method: 'GET',
        path: '/v1/email/inbound',
        body: {
          data: [],
          nextCursor: 'cur_page2',
          deniedAccountIds: [],
          unreachableAccountIds: [],
        },
      },
    ]);
    const client = await connectTool(registerListInboundEmails, makeApiConfig());

    const first = await client.callTool({
      name: 'list_inbound_emails',
      arguments: { limit: 5 },
    });
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toMatchObject({ emails: [], nextCursor: 'cur_page2' });

    const second = await client.callTool({
      name: 'list_inbound_emails',
      arguments: { limit: 5, cursor: 'cur_page2' },
    });
    expect(second.isError).toBeFalsy();
    expect(second.structuredContent).toMatchObject({
      emails: [{ id: 'em_b7', awsAccountId: 'acct_2' }],
      nextCursor: null,
    });
    const text = (second.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('This is the last page');

    expect(api.calls).toHaveLength(2);
    expect(api.calls[0].query).toEqual({ limit: '5' });
    expect(api.calls[1].query).toEqual({ limit: '5', cursor: 'cur_page2' });
    await client.close();
  });

  it('passes awsAccountId through as a query parameter and omits the unset ones', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/email/inbound',
        query: { awsAccountId: 'acct_1' },
        body: {
          data: [EMAIL_A],
          nextCursor: null,
          deniedAccountIds: [],
          unreachableAccountIds: [],
        },
      },
    ]);
    const client = await connectTool(registerListInboundEmails, makeApiConfig());

    const result = await client.callTool({
      name: 'list_inbound_emails',
      arguments: { awsAccountId: 'acct_1' },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].query).toEqual({ awsAccountId: 'acct_1' });
    await client.close();
  });

  it('maps an API error (404, account not in this org) to a tool error that names the fix', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/email/inbound',
        status: 404,
        body: { error: 'AWS account not found' },
      },
    ]);
    const client = await connectTool(registerListInboundEmails, makeApiConfig());

    const result = await client.callTool({
      name: 'list_inbound_emails',
      arguments: { awsAccountId: 'acct_other_org' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Not found in this organization');
    expect(text).toContain('AWS account not found');
    expect(text).toContain('Check the id');
    await client.close();
  });

  it('is annotated read-only and its description states S3 key order, pagination and truncation', async () => {
    const client = await connectTool(registerListInboundEmails, makeApiConfig());

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'list_inbound_emails');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool?.description).toMatch(/S3 key order/);
    expect(tool?.description).toMatch(/Pagination/);
    expect(tool?.description).toMatch(/Truncation/);
    expect(tool?.description).toMatch(/nextCursor/);
    await client.close();
  });
});
