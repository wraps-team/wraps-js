import { describe, expect, it } from 'vitest';
import { registerGetEmailMetrics } from '../../tools/get-email-metrics.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const COUNTS = {
  sent: 100,
  delivered: 95,
  bounced: 3,
  bouncedPermanent: 2,
  bouncedTransient: 1,
  bouncedUndetermined: 0,
  complained: 0,
  suppressed: 1,
  opened: 40,
  openedRaw: 45,
  clicked: 12,
  failed: 1,
};

const META = {
  start_date: '2026-10-23T00:00:00.000Z',
  end_date: '2026-10-29T00:00:00.000Z',
  timezone: 'UTC',
  granularity: 'daily',
  dimensions: [],
  cost: {
    currency: 'USD',
    basis: 'monthly-average',
    billingTimezone: 'UTC',
    includes: ['ses-outbound-sending'],
    excludes: ['plan-base-fee'],
    planSource: 'current',
    plans: { aws_1: 'ESSENTIALS' },
    unattributed: 0,
  },
};

const TOTALS_BODY = {
  object: 'metrics',
  totals: { ...COUNTS, costUsd: 0.12 },
  data: [],
  meta: META,
};

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('get_email_metrics', () => {
  it('returns totals with no query when no dates or filters are given, and sends one request', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/email/metrics', body: TOTALS_BODY }]);
    const client = await connectTool(registerGetEmailMetrics, makeApiConfig());

    const result = await client.callTool({ name: 'get_email_metrics', arguments: {} });

    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as {
      totals: { sent: number; delivered: number; costUsd: number | null };
      data: unknown[];
      meta: { cost: { plans: Record<string, string | null> } };
    };
    expect(data.totals).toMatchObject({ sent: 100, delivered: 95, costUsd: 0.12 });
    expect(data.data).toEqual([]);
    expect(data.meta.cost.plans).toEqual({ aws_1: 'ESSENTIALS' });
    expect(text(result)).toContain('100 sent, 95 delivered');
    // Single aggregate response: no pagination parameter is sent.
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/v1/email/metrics', query: {} });
    expect(api.calls[0].query).not.toHaveProperty('cursor');
    expect(api.calls[0].query).not.toHaveProperty('page');
    expect(api.calls[0].query).not.toHaveProperty('offset');
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    await client.close();
  });

  it('sends the window, granularity, comma-joined dimensions and filters, and gives each data row a stable id', async () => {
    const api = mockApi([
      {
        method: 'GET',
        path: '/v1/email/metrics',
        query: {
          start_date: '2026-10-01',
          end_date: '2026-10-29',
          granularity: 'daily',
          dimensions: 'domain,broadcast',
          domain: 'a.com,b.com',
          broadcast_id: 'bc_1',
        },
        body: {
          ...TOTALS_BODY,
          totals: { ...COUNTS, costUsd: null },
          data: [
            {
              ...COUNTS,
              domain: 'a.com',
              broadcastId: 'bc_1',
              costUsd: null,
            },
          ],
          meta: { ...META, dimensions: ['domain', 'broadcast'] },
        },
      },
    ]);
    const client = await connectTool(registerGetEmailMetrics, makeApiConfig());

    const result = await client.callTool({
      name: 'get_email_metrics',
      arguments: {
        start_date: '2026-10-01',
        end_date: '2026-10-29',
        granularity: 'daily',
        dimensions: ['domain', 'broadcast'],
        domain: ['a.com', 'b.com'],
        broadcast_id: ['bc_1'],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(api.calls[0].query).toEqual({
      start_date: '2026-10-01',
      end_date: '2026-10-29',
      granularity: 'daily',
      dimensions: 'domain,broadcast',
      domain: 'a.com,b.com',
      broadcast_id: 'bc_1',
    });
    const data = result.structuredContent as {
      totals: { costUsd: number | null };
      data: Array<{ id: string; domain: string; broadcastId: string; costUsd: number | null }>;
    };
    expect(data.data).toHaveLength(1);
    expect(data.data[0]).toMatchObject({ id: '["a.com","bc_1"]', domain: 'a.com', costUsd: null });
    expect(data.totals.costUsd).toBeNull();
    expect(text(result)).toContain('cost unknown');
    await client.close();
  });

  it('maps a window the server refuses (400) to a tool error that says how to narrow it', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/email/metrics',
        status: 400,
        body: {
          error:
            'Metrics query returned more than 10000 rows; narrow the time window, add filters, or use a coarser granularity',
        },
      },
    ]);
    const client = await connectTool(registerGetEmailMetrics, makeApiConfig());

    const result = await client.callTool({
      name: 'get_email_metrics',
      arguments: { dimensions: ['period'], granularity: 'hourly' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('rejected the request');
    expect(text(result)).toContain('narrow the time window');
    expect(text(result)).toContain('Fix the arguments');
    await client.close();
  });

  it('rejects an unknown dimension before any request is sent', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerGetEmailMetrics, makeApiConfig());

    let rejected = false;
    try {
      const result = await client.callTool({
        name: 'get_email_metrics',
        arguments: { dimensions: ['country'] },
      });
      rejected = result.isError === true;
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('refuses without sending a request when no Wraps credential is configured', async () => {
    const api = mockApi([]);
    const client = await connectTool(registerGetEmailMetrics, makeApiConfig({ api: null }));

    const result = await client.callTool({ name: 'get_email_metrics', arguments: {} });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('is read-only and idempotent, and says pagination is none and nothing is truncated', async () => {
    const client = await connectTool(registerGetEmailMetrics, makeApiConfig());

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'get_email_metrics');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(tool?.description).toMatch(/Pagination: none/);
    expect(tool?.description).toMatch(/hasMore/);
    await client.close();
  });
});
