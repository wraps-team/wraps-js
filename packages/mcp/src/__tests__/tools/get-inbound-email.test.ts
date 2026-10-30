import { describe, expect, it } from 'vitest';
import { registerGetInboundEmail } from '../../tools/get-inbound-email.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const DETAIL = {
  awsAccountId: 'acct_1',
  emailId: 'em_a1',
  messageId: '<msg-1@mail.example.com>',
  from: { address: 'sender@example.com', name: 'Sender' },
  to: [{ address: 'support@acme.example', name: '' }],
  cc: [{ address: 'boss@acme.example', name: 'Boss' }],
  subject: 'Invoice question',
  date: 'Tue, 20 Oct 2026 09:00:00 +0000',
  html: '<p>Hello</p>',
  htmlTruncated: true,
  text: 'Hello',
  headers: { 'x-mailer': 'TestMailer', 'content-type': 'multipart/mixed' },
  attachments: [
    {
      id: 'att_1',
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 48213,
      s3Key: 'attachments/em_a1/invoice.pdf',
      contentDisposition: 'attachment',
      cid: null,
    },
  ],
  spamVerdict: 'PASS',
  virusVerdict: 'PASS',
  rawS3Key: 'emails/em_a1',
  receivedAt: '2026-10-20T09:00:00.000Z',
};

describe('get_inbound_email', () => {
  it('returns one record with the body, headers and attachment metadata, and pins the request sent', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/email/inbound/em_a1', body: DETAIL }]);
    const client = await connectTool(registerGetInboundEmail, makeApiConfig());

    const result = await client.callTool({
      name: 'get_inbound_email',
      arguments: { emailId: 'em_a1' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: 'em_a1',
      emailId: 'em_a1',
      awsAccountId: 'acct_1',
      messageId: '<msg-1@mail.example.com>',
      htmlTruncated: true,
      text: 'Hello',
      headers: { 'x-mailer': 'TestMailer' },
      attachments: [{ id: 'att_1', filename: 'invoice.pdf', size: 48213 }],
      rawS3Key: 'emails/em_a1',
    });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'GET',
      path: '/v1/email/inbound/em_a1',
      query: {},
    });
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('truncated at receipt');
    expect(text).toContain('1 attachment (metadata only)');
    await client.close();
  });

  it('sends awsAccountId as a query parameter so only that account is read', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/email/inbound/em_a1',
        query: { awsAccountId: 'acct_1' },
        body: { ...DETAIL, htmlTruncated: false, attachments: [] },
      },
    ]);
    const client = await connectTool(registerGetInboundEmail, makeApiConfig());

    const result = await client.callTool({
      name: 'get_inbound_email',
      arguments: { emailId: 'em_a1', awsAccountId: 'acct_1' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ htmlTruncated: false, attachments: [] });
    expect(api.calls[0].query).toEqual({ awsAccountId: 'acct_1' });
    await client.close();
  });

  it('maps an API error (404, email not found) to a tool error that names the fix', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/email/inbound/em_missing',
        status: 404,
        body: { error: 'Inbound email not found' },
      },
    ]);
    const client = await connectTool(registerGetInboundEmail, makeApiConfig());

    const result = await client.callTool({
      name: 'get_inbound_email',
      arguments: { emailId: 'em_missing' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Not found in this organization');
    expect(text).toContain('Inbound email not found');
    expect(text).toContain('Check the id');
    await client.close();
  });

  it('is annotated read-only and its description states single record, truncation and metadata-only attachments', async () => {
    const client = await connectTool(registerGetInboundEmail, makeApiConfig());

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'get_inbound_email');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool?.description).toMatch(/single record/);
    expect(tool?.description).toMatch(/Truncation/);
    expect(tool?.description).toMatch(/htmlTruncated/);
    expect(tool?.description).toMatch(/metadata only/);
    await client.close();
  });
});
