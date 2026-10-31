import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const HEALTH_STATUS = z.enum(['healthy', 'at_risk', 'in_danger', 'unknown']);

const GetAccountHealthInputSchema = {
  awsAccountId: z
    .string()
    .min(1)
    .max(36)
    .optional()
    .describe(
      'Optional. The Wraps id of one connected AWS account: a UUID, the awsAccountId field of the account-health output, NOT the 12-digit AWS account number. Omit it to get every connected account and the organization-wide rollup.'
    ),
};

const AccountHealthSchema = z.object({
  id: z
    .string()
    .describe('The Wraps id of the AWS account (the awsAccountId used by other tools).'),
  accountNumber: z.string().describe('The 12-digit AWS account number. Not an id for other tools.'),
  region: z.string(),
  status: HEALTH_STATUS,
  checkedAt: z
    .string()
    .nullable()
    .describe('When the hourly sweep last saved this health (ISO 8601).'),
  sandbox: z.boolean().nullable(),
  productionAccessEnabled: z.boolean().nullable(),
  sendingEnabled: z.boolean().nullable(),
  enforcementStatus: z.string().nullable(),
  quota: z.object({
    max24Hour: z.number().nullable(),
    sentLast24Hours: z.number().nullable(),
    usedRatio: z.number().nullable().describe('sentLast24Hours divided by max24Hour, 0 to 1.'),
    maxSendRate: z.number().nullable(),
  }),
  reputation: z.object({
    bounceRate: z.number().nullable(),
    complaintRate: z.number().nullable(),
  }),
  thresholds: z
    .object({
      bounceReview: z.number(),
      bouncePause: z.number(),
      complaintReview: z.number(),
      complaintPause: z.number(),
      quotaWarn: z.number(),
    })
    .describe('The rates and quota levels that move the status.'),
  reasons: z.array(z.string()).describe('Why the account has its status, in plain words.'),
});

const GetAccountHealthOutputSchema = {
  status: HEALTH_STATUS.describe(
    'The worst status across the accounts returned (unknown outranks healthy). For one account, that account status.'
  ),
  checkedAt: z
    .string()
    .nullable()
    .describe(
      'The oldest check time among the accounts (ISO 8601), or null when none has been checked. Old values mean the status may be stale.'
    ),
  accounts: z.array(AccountHealthSchema).describe('One entry per account returned.'),
};

type AccountHealth = z.infer<typeof AccountHealthSchema>;

interface RollupApiResponse {
  status: z.infer<typeof HEALTH_STATUS>;
  checkedAt: string | null;
  accounts: AccountHealth[];
}

/**
 * SES health for the connected AWS accounts. Read-only and Postgres-only on the API side: no AWS
 * calls. Calls `GET /v1/account/health`, or `GET /v1/account/health/:awsAccountId` for one account.
 */
export function registerGetAccountHealth(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_account_health',
    {
      description:
        'Get the SES sending health of the AWS accounts connected to your Wraps organization: status (healthy, at_risk, in_danger or unknown), when it was last checked, the quota and reputation figures, and the reasons for the status. Use it to see whether sending is at risk before a send or a broadcast. Read-only. It reads the health the hourly sweep last saved and makes no AWS calls, so checkedAt says how fresh it is. Pass awsAccountId to read one account; omit it to read every account and the organization-wide status, where the worst status wins. awsAccountId is the Wraps id, not the 12-digit AWS account number. Pagination: none; the response is the whole list. Truncation: nothing is cut. A 404 means no connected account with that id belongs to this organization.',
      inputSchema: GetAccountHealthInputSchema,
      outputSchema: GetAccountHealthOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }

      if (input.awsAccountId === undefined) {
        const res = await apiRequest<RollupApiResponse>(resolved.api, {
          method: 'GET',
          path: '/v1/account/health',
        });
        if (!res.ok) {
          return res.error;
        }
        const { status, checkedAt, accounts } = res.data;
        return textResult(formatReport(status, checkedAt, accounts), {
          status,
          checkedAt,
          accounts,
        });
      }

      const res = await apiRequest<AccountHealth>(resolved.api, {
        method: 'GET',
        path: `/v1/account/health/${seg(input.awsAccountId)}`,
      });
      if (!res.ok) {
        return res.error;
      }
      const account = res.data;
      return textResult(formatReport(account.status, account.checkedAt, [account]), {
        status: account.status,
        checkedAt: account.checkedAt,
        accounts: [account],
      });
    }
  );
}

function formatReport(status: string, checkedAt: string | null, accounts: AccountHealth[]): string {
  if (accounts.length === 0) {
    return 'No AWS accounts are connected to this organization, so there is no SES health to report. Status: unknown.';
  }
  const checked = checkedAt ? `Last checked ${checkedAt}.` : 'No check has been saved yet.';
  const lines = accounts.map((a) => {
    const reasons = a.reasons.length > 0 ? `; ${a.reasons.join('; ')}` : '';
    return `- ${a.region}, account ${a.accountNumber} (id ${a.id}): ${a.status}${reasons}`;
  });
  return `SES health: ${status}. ${checked}\n${lines.join('\n')}`;
}
