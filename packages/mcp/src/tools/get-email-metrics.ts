import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';

const MAX_FILTER_VALUES = 100;

const DIMENSIONS = [
  'period',
  'domain',
  'broadcast',
  'template',
  'source',
  'account',
  'region',
] as const;

/** Route dimension name -> the row field that holds its value (mirrors the API's row shape). */
const DIMENSION_FIELD = {
  period: 'period',
  domain: 'domain',
  broadcast: 'broadcastId',
  template: 'templateId',
  source: 'source',
  account: 'awsAccountId',
  region: 'region',
} as const;

const GetEmailMetricsInput = {
  start_date: z
    .string()
    .optional()
    .describe(
      'Window start, ISO 8601 date or datetime. Omit for the default window: the 6 days ending at end_date (or now). Must not be after end_date.'
    ),
  end_date: z
    .string()
    .optional()
    .describe(
      'Window end, ISO 8601 date or datetime. Omit for now. A future date is clamped to now.'
    ),
  timezone: z
    .string()
    .optional()
    .describe('IANA timezone for period buckets, e.g. Europe/London. Defaults to UTC.'),
  granularity: z
    .enum(['hourly', 'daily', 'weekly', 'monthly'])
    .optional()
    .describe(
      'Size of each period bucket. Defaults to daily. Only used with the period dimension.'
    ),
  dimensions: z
    .array(z.enum(DIMENSIONS))
    .max(DIMENSIONS.length)
    .optional()
    .describe(
      'Group the rows by these dimensions. Omit for totals only (data is then empty). Each data row carries the values for the dimensions you asked for.'
    ),
  broadcast_id: z
    .array(z.string().min(1))
    .max(MAX_FILTER_VALUES)
    .optional()
    .describe(`Only count sends from these broadcast ids (up to ${MAX_FILTER_VALUES}).`),
  template_id: z
    .array(z.string().min(1))
    .max(MAX_FILTER_VALUES)
    .optional()
    .describe(`Only count sends from these template ids (up to ${MAX_FILTER_VALUES}).`),
  aws_account_id: z
    .array(z.string().min(1))
    .max(MAX_FILTER_VALUES)
    .optional()
    .describe(
      `Only count sends from these connected AWS account ids (up to ${MAX_FILTER_VALUES}). These are Wraps account ids (UUIDs, the awsAccountId field from the domains and account-health routes), NOT 12-digit AWS account numbers.`
    ),
  domain: z
    .array(z.string().min(1))
    .max(MAX_FILTER_VALUES)
    .optional()
    .describe(`Only count sends from these sending domains (up to ${MAX_FILTER_VALUES}).`),
};

const Counts = {
  sent: z.number(),
  delivered: z.number(),
  bounced: z.number(),
  bouncedPermanent: z.number(),
  bouncedTransient: z.number(),
  bouncedUndetermined: z.number(),
  complained: z.number(),
  suppressed: z.number(),
  opened: z.number().describe('Opens with known bot user agents removed.'),
  openedRaw: z.number().describe('Opens with no bot filter applied.'),
  clicked: z.number(),
  failed: z.number(),
};

const GetEmailMetricsOutput = z.object({
  object: z.literal('metrics'),
  totals: z.object({
    ...Counts,
    costUsd: z.number().nullable().describe('Estimated SES outbound cost, USD. null = unknown.'),
  }),
  data: z.array(
    z.object({
      id: z
        .string()
        .describe(
          'Stable key for this row: the JSON array of its dimension values, in the order of meta.dimensions.'
        ),
      period: z.string().optional(),
      domain: z.string().nullable().optional(),
      broadcastId: z.string().nullable().optional(),
      templateId: z.string().nullable().optional(),
      source: z.string().optional(),
      awsAccountId: z.string().optional(),
      region: z.string().nullable().optional(),
      ...Counts,
      costUsd: z.number().nullable(),
    })
  ),
  meta: z.object({
    start_date: z.string(),
    end_date: z.string(),
    timezone: z.string(),
    granularity: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
    dimensions: z.array(z.enum(DIMENSIONS)),
    cost: z.object({
      currency: z.literal('USD'),
      basis: z.literal('monthly-average'),
      billingTimezone: z.literal('UTC'),
      includes: z.array(z.string()),
      excludes: z.array(z.string()),
      planSource: z.literal('current'),
      plans: z
        .record(z.string(), z.enum(['ENTERPRISE', 'ESSENTIALS', 'NONE', 'PRO']).nullable())
        .describe(
          'SES pricing plan per AWS account id that has billable sends; null = no recorded plan.'
        ),
      unattributed: z.number().describe('Rows whose cost is unknown.'),
    }),
  }),
});

type MetricsResponse = z.infer<typeof GetEmailMetricsOutput>;

function joinList(values: string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(',') : undefined;
}

/**
 * Aggregate email sending metrics for the organization over a time window. Read-only.
 * Calls `GET /v1/email/metrics`. The route is not paginated and answers in one response.
 */
export function registerGetEmailMetrics(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_email_metrics',
    {
      description:
        'Get aggregate email sending metrics for this organization over a time window: sent, delivered, bounced (split into permanent, transient and undetermined), complained, suppressed, opened, clicked, failed, and an estimated costUsd. Use this for "how did sending go" questions. For one message\'s own events use get_email_event_log, and for individual sends use list_recent_sends. With no dates it covers the 6 days ending now. Group with dimensions (period, domain, broadcast, template, source, account, region); period buckets follow granularity. Filter with broadcast_id, template_id, aws_account_id or domain (each up to 100 values). Pagination: none. The response is a single aggregate object: totals, and data with one row per dimension combination (empty when no dimensions are given). Truncation: nothing is silently cut and hasMore is never set; a window that would return more rows than the server allows is refused with an error, so narrow the dates or use a coarser granularity. costUsd is an estimate from published SES rates for outbound sending only; null means the cost is unknown.',
      inputSchema: GetEmailMetricsInput,
      outputSchema: GetEmailMetricsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }

      const result = await apiRequest<MetricsResponse>(credential.api, {
        method: 'GET',
        path: '/v1/email/metrics',
        query: {
          start_date: input.start_date,
          end_date: input.end_date,
          timezone: input.timezone,
          granularity: input.granularity,
          dimensions: joinList(input.dimensions),
          broadcast_id: joinList(input.broadcast_id),
          template_id: joinList(input.template_id),
          aws_account_id: joinList(input.aws_account_id),
          domain: joinList(input.domain),
        },
      });
      if (!result.ok) {
        return result.error;
      }

      const body = result.data;
      const rows = (body.data ?? []).map((row) => {
        const values = body.meta.dimensions.map((dim) => {
          const field = DIMENSION_FIELD[dim] as keyof typeof row;
          return row[field] ?? null;
        });
        return { ...row, id: JSON.stringify(values) };
      });

      const cost = body.totals.costUsd;
      const costText = cost === null ? 'cost unknown' : `about $${cost.toFixed(2)} SES outbound`;
      return textResult(
        `${body.totals.sent} sent, ${body.totals.delivered} delivered, ${body.totals.bounced} bounced, ${body.totals.complained} complained, ${body.totals.failed} failed (${costText}) from ${body.meta.start_date} to ${body.meta.end_date}. ${rows.length} data row${rows.length === 1 ? '' : 's'}.`,
        { ...body, data: rows }
      );
    }
  );
}
