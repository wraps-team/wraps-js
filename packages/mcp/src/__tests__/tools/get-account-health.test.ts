import { describe, expect, it } from 'vitest';
import { registerGetAccountHealth } from '../../tools/get-account-health.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const VIEW = {
  id: 'aws_row_1',
  accountNumber: '123456789012',
  region: 'us-east-1',
  status: 'at_risk',
  checkedAt: '2026-10-31T10:00:00.000Z',
  sandbox: false,
  productionAccessEnabled: true,
  sendingEnabled: true,
  enforcementStatus: null,
  quota: { max24Hour: 50000, sentLast24Hours: 1200, usedRatio: 0.024, maxSendRate: 14 },
  reputation: { bounceRate: 0.021, complaintRate: 0.0001 },
  thresholds: {
    bounceReview: 0.02,
    bouncePause: 0.05,
    complaintReview: 0.0005,
    complaintPause: 0.001,
    quotaWarn: 0.8,
  },
  reasons: ['Bounce rate 2.1% is above the 2% review line.'],
};

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('get_account_health', () => {
  it('reads the organization-wide health when no account id is given', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/account/health',
        body: { status: 'at_risk', checkedAt: VIEW.checkedAt, accounts: [VIEW] },
      },
    ]);
    const client = await connectTool(registerGetAccountHealth, makeApiConfig());

    const result = await client.callTool({ name: 'get_account_health', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/v1/account/health' });
    expect(result.structuredContent).toEqual({
      status: 'at_risk',
      checkedAt: VIEW.checkedAt,
      accounts: [VIEW],
    });
    expect(text(result)).toContain('SES health: at_risk');
    expect(text(result)).toContain('Bounce rate 2.1% is above the 2% review line.');
    await client.close();
  });

  it('reads one account by its Wraps id when awsAccountId is given, and wraps it as one account', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/account/health/aws_row_1',
        body: { ...VIEW, status: 'healthy', reasons: [] },
      },
    ]);
    const client = await connectTool(registerGetAccountHealth, makeApiConfig());

    const result = await client.callTool({
      name: 'get_account_health',
      arguments: { awsAccountId: 'aws_row_1' },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/v1/account/health/aws_row_1' });
    expect(result.structuredContent).toMatchObject({
      status: 'healthy',
      checkedAt: VIEW.checkedAt,
      accounts: [{ id: 'aws_row_1', accountNumber: '123456789012', status: 'healthy' }],
    });
    await client.close();
  });

  it('surfaces a 404 for an account that is not in this organization', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/account/health/aws_other_org',
        status: 404,
        body: { error: 'AWS account not found', code: 'NOT_FOUND' },
      },
    ]);
    const client = await connectTool(registerGetAccountHealth, makeApiConfig());

    const result = await client.callTool({
      name: 'get_account_health',
      arguments: { awsAccountId: 'aws_other_org' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found in this organization');
    expect(text(result)).toContain('AWS account not found');
    await client.close();
  });

  it('is read-only, and its description says the id is the Wraps id, not the 12-digit number', async () => {
    const client = await connectTool(registerGetAccountHealth, makeApiConfig());

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'get_account_health');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool?.description).toMatch(/Pagination: none/);
    expect(tool?.description).toMatch(/12-digit/);
    await client.close();
  });
});
