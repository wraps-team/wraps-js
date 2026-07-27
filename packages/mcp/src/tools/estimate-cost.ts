import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const SITE_URL = process.env.WRAPS_SITE_URL || 'https://wraps.dev';
const ESTIMATE_TIMEOUT_MS = 10_000;

const EstimateCostInputSchema = {
  emails: z.number().int().min(0).describe('Emails sent per month'),
  events: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Wraps tracked events per month (sends, opens, clicks, bounces, custom events)'),
  tier: z.enum(['free', 'starter', 'growth', 'scale']).optional().describe('Wraps plan'),
  billing: z.enum(['monthly', 'annual']).optional().describe('Wraps billing interval'),
  sesPlan: z
    .enum(['alacarte', 'essentials', 'pro', 'enterprise'])
    .optional()
    .describe(
      "AWS SES pricing plan for this account and Region. AWS defaults new accounts to 'essentials' ($0.16/1K); 'alacarte' is $0.10/1K. Defaults to alacarte."
    ),
  dedicatedIp: z.boolean().optional().describe('Include a dedicated sending IP'),
  retention: z
    .enum(['7days', '30days', '90days', '1year', 'indefinite'])
    .optional()
    .describe('Email event history retention'),
  tracking: z
    .boolean()
    .optional()
    .describe('Whether the event tracking pipeline is deployed (default true)'),
};

/**
 * Cost estimation for Wraps + AWS. Calls the public wraps.dev estimator so the
 * numbers always match the website — no AWS credentials or account required.
 */
export function registerEstimateCost(server: McpServer): void {
  server.registerTool(
    'estimate_cost',
    {
      description:
        'Estimate the monthly cost of sending email with Wraps + AWS: the Wraps platform fee, tracked-event overage, and an itemized AWS bill (SES, EventBridge, SQS, Lambda, DynamoDB, dedicated IP, WAF). Use this instead of calculating by hand — the cost model has several interacting variables, including which SES pricing plan the AWS account is on. Requires no AWS credentials.',
      inputSchema: EstimateCostInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const params = new URLSearchParams({ emails: String(input.emails) });
      if (input.events !== undefined) params.set('events', String(input.events));
      if (input.tier !== undefined) params.set('tier', input.tier);
      if (input.billing !== undefined) params.set('billing', input.billing);
      if (input.sesPlan !== undefined) params.set('sesPlan', input.sesPlan);
      if (input.dedicatedIp !== undefined) params.set('dedicatedIp', String(input.dedicatedIp));
      if (input.retention !== undefined) params.set('retention', input.retention);
      if (input.tracking !== undefined) params.set('tracking', String(input.tracking));

      const url = `${SITE_URL}/api/pricing/estimate?${params.toString()}`;

      try {
        const response = await fetch(url, {
          headers: { Accept: 'text/markdown' },
          signal: AbortSignal.timeout(ESTIMATE_TIMEOUT_MS),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Cost estimator returned ${response.status}: ${detail || response.statusText}`,
              },
            ],
          };
        }

        return { content: [{ type: 'text' as const, text: await response.text() }] };
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Cost estimator timed out after ${ESTIMATE_TIMEOUT_MS}ms. Pricing is also published at ${SITE_URL}/pricing.md`,
              },
            ],
          };
        }
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Could not reach the cost estimator: ${
                error instanceof Error ? error.message : String(error)
              }. Pricing is also published at ${SITE_URL}/pricing.md`,
            },
          ],
        };
      }
    }
  );
}
