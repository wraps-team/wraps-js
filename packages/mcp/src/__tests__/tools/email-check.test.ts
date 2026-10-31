import { describe, expect, it } from 'vitest';
import { registerEmailCheck } from '../../tools/email-check.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const REPORT = {
  success: true,
  domain: 'example.com',
  checkedAt: '2026-10-31T10:00:00.000Z',
  duration: 812,
  score: { grade: 'B', score: 80, maxScore: 100, breakdown: {} },
  spf: {
    exists: true,
    valid: true,
    record: 'v=spf1 -all',
    lookupCount: 1,
    lookupLimit: 10,
    allMechanism: '-all',
    includes: [],
    hasPtr: false,
    warnings: [],
  },
  issues: [
    { check: 'dmarc', reason: 'No DMARC record was found', points: 20, severity: 'critical' },
  ],
  bonuses: [],
};

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('email_check', () => {
  it('posts the domain to the public tools route and returns the grade and issues', async () => {
    const api = mockApi([{ method: 'POST', path: '/tools/email-check', body: REPORT }]);
    const client = await connectTool(registerEmailCheck, makeApiConfig());

    const result = await client.callTool({
      name: 'email_check',
      arguments: { domain: 'example.com' },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'POST', path: '/tools/email-check' });
    expect(api.calls[0].body).toEqual({ domain: 'example.com' });
    expect(result.structuredContent).toMatchObject({
      domain: 'example.com',
      grade: 'B',
      score: 80,
      maxScore: 100,
      issues: [{ check: 'dmarc', points: 20, severity: 'critical' }],
    });
    expect((result.structuredContent as { report: { spf: unknown } }).report.spf).toEqual(
      REPORT.spf
    );
    expect(text(result)).toContain('grade B (80/100)');
    expect(text(result)).toContain('No DMARC record was found');
    await client.close();
  });

  it('forwards the check options as given', async () => {
    const api = mockApi([{ method: 'POST', path: '/tools/email-check', body: REPORT }]);
    const client = await connectTool(registerEmailCheck, makeApiConfig());

    await client.callTool({
      name: 'email_check',
      arguments: {
        domain: 'example.com',
        quick: true,
        skipBlacklists: false,
        dkimSelectors: ['abc123', 'def456'],
      },
    });

    expect(api.calls[0].body).toEqual({
      domain: 'example.com',
      quick: true,
      skipBlacklists: false,
      dkimSelectors: ['abc123', 'def456'],
    });
    await client.close();
  });

  it('turns a 200 with success false into a tool error, not a grade', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/tools/email-check',
        body: { success: false, error: 'Invalid domain format', domain: 'not a domain' },
      },
    ]);
    const client = await connectTool(registerEmailCheck, makeApiConfig());

    const result = await client.callTool({
      name: 'email_check',
      arguments: { domain: 'not a domain' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Invalid domain format');
    expect(text(result)).toContain('Nothing was checked');
    expect(result.structuredContent).toBeUndefined();
    await client.close();
  });

  it('sends no Authorization or x-organization-id header, because the route is public', async () => {
    const api = mockApi([{ method: 'POST', path: '/tools/email-check', body: REPORT }]);
    const client = await connectTool(
      registerEmailCheck,
      makeApiConfig({
        api: {
          token: 'test-token-not-real',
          tokenType: 'api-key',
          apiBase: 'https://api.wraps.test',
          source: 'env',
          orgId: 'org_123',
        },
      })
    );

    await client.callTool({ name: 'email_check', arguments: { domain: 'example.com' } });

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].headers.authorization).toBeUndefined();
    expect(api.calls[0].headers['x-organization-id']).toBeUndefined();
    expect(api.calls[0].headers['user-agent']).toMatch(/^wraps-mcp\//);
    await client.close();
  });

  it('is read-only, public and rate limited in its description', async () => {
    const client = await connectTool(registerEmailCheck, makeApiConfig());

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'email_check');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool?.description).toMatch(/10 requests per minute/);
    expect(tool?.description).toMatch(/WITHOUT your Wraps credential/);
    expect(tool?.description).toMatch(/Pagination: none/);
    await client.close();
  });
});
