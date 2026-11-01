import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const MAX_ADDRESSES = 100;

const AddSuppressionInput = {
  emails: z
    .array(z.string().min(1).max(320))
    .min(1)
    .max(MAX_ADDRESSES)
    .describe(
      `The addresses to suppress, 1 to ${MAX_ADDRESSES} per call, exactly as the user gave them. One address is added with a single request; more than one with a single bulk request. Each address is checked on its own: an invalid address or a failed add fails only that address.`
    ),
  awsAccountId: z
    .string()
    .min(1)
    .max(128)
    .describe(
      'Required. The Wraps id of the connected AWS account whose suppression list receives the addresses: a UUID from the account record (the awsAccountId field the domains and account-health routes return), NOT the 12-digit AWS account number. The API checks it belongs to this organization.'
    ),
  reason: z
    .enum(['BOUNCE', 'COMPLAINT'])
    .describe(
      'Why the addresses are suppressed. BOUNCE: the address hard-bounced. COMPLAINT: the recipient marked a message as spam. A COMPLAINT is never downgraded: an address already suppressed as COMPLAINT stays COMPLAINT when BOUNCE is asked for. A BOUNCE can be upgraded to COMPLAINT. An address already suppressed for the same reason is a no-op and is reported as alreadyPresent.'
    ),
  confirm: confirmSchema,
};

const AddSuppressionResultSchema = z.object({
  email: z.string().describe('The address, as the caller sent it.'),
  success: z.boolean(),
  alreadyPresent: z
    .boolean()
    .optional()
    .describe(
      'Present on a success only. true when the address was already suppressed, so nothing was written.'
    ),
  error: z
    .string()
    .optional()
    .describe('Present on a failure only: why this address was not added.'),
});

const AddSuppressionOutput = z.object({
  awsAccountId: z.string(),
  reason: z.enum(['BOUNCE', 'COMPLAINT']),
  results: z
    .array(AddSuppressionResultSchema)
    .describe('One entry per address sent, in the same order.'),
  added: z.number().int().describe('Addresses newly added to the suppression list.'),
  alreadyPresent: z.number().int().describe('Addresses that were already suppressed.'),
  failed: z.number().int().describe('Addresses that were not added. See each result error.'),
});

interface SingleApiResponse {
  success: true;
  email: string;
  awsAccountId: string;
  alreadyPresent: boolean;
}

interface BulkApiResponse {
  results: (
    | { email: string; success: true; alreadyPresent: boolean }
    | { email: string; success: false; error: string }
  )[];
}

type AddSuppressionOutputValue = z.infer<typeof AddSuppressionOutput>;

function summarize(output: AddSuppressionOutputValue): string {
  const counts = `${output.added} added, ${output.alreadyPresent} already suppressed, ${output.failed} failed`;
  const head = `Suppression list of AWS account ${output.awsAccountId} (reason ${output.reason}): ${counts}.`;
  const failures = output.results.filter((r) => !r.success);
  if (failures.length === 0) {
    return `${head} Wraps will not send to these addresses. Undo one with remove_suppression.`;
  }
  const lines = failures.map((r) => `${r.email}: ${r.error ?? 'failed'}`);
  return `${head} Not added: ${lines.join('; ')}.`;
}

/**
 * Add one or more addresses to the SES suppression list of one AWS account, so Wraps stops
 * sending to them. Writes and destructive. One address calls `POST /v1/suppressions`; more
 * call `POST /v1/suppressions/bulk`.
 */
export function registerAddSuppression(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'add_suppression',
    {
      description:
        'Add one or more email addresses to the SES account-level suppression list of one AWS account, so Wraps stops sending to them. A matching contact, if there is one, is marked suppressed so broadcasts skip it. Use this when the user asks to stop mail to an address, or after a bounce or complaint the user has confirmed. Requires confirm: true. Irreversible until undone: Wraps will not send to these addresses while they stay suppressed. Undo one address at a time with remove_suppression. Requires WRAPS_WRITE_ENABLED=true. Pagination: none; one call adds up to 100 addresses and makes one request (a single address uses the single route, more use the bulk route). Truncation: not applicable, nothing is cut and hasMore is never set. Results has one entry per address sent, in the same order; the call is an error only when every address failed or the request itself failed.',
      inputSchema: AddSuppressionInput,
      outputSchema: AddSuppressionOutput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      const writeRefusal = requireWrite(config);
      if (writeRefusal) {
        return writeRefusal;
      }
      const confirmRefusal = requireConfirm(input);
      if (confirmRefusal) {
        return confirmRefusal;
      }
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }

      const { awsAccountId, reason, emails } = input;

      let output: AddSuppressionOutputValue;
      if (emails.length === 1) {
        const result = await apiRequest<SingleApiResponse>(credential.api, {
          method: 'POST',
          path: '/v1/suppressions',
          body: { awsAccountId, email: emails[0], reason },
        });
        if (!result.ok) {
          return result.error;
        }
        const { email, alreadyPresent } = result.data;
        output = {
          awsAccountId,
          reason,
          results: [{ email, success: true, alreadyPresent }],
          added: alreadyPresent ? 0 : 1,
          alreadyPresent: alreadyPresent ? 1 : 0,
          failed: 0,
        };
      } else {
        const result = await apiRequest<BulkApiResponse>(credential.api, {
          method: 'POST',
          path: '/v1/suppressions/bulk',
          body: {
            entries: emails.map((email) => ({ awsAccountId, email, reason })),
          },
        });
        if (!result.ok) {
          return result.error;
        }
        const results = result.data.results.map((entry) =>
          entry.success
            ? { email: entry.email, success: true, alreadyPresent: entry.alreadyPresent }
            : { email: entry.email, success: false, error: entry.error }
        );
        const alreadyPresent = results.filter((r) => r.success && r.alreadyPresent).length;
        const failed = results.filter((r) => !r.success).length;
        output = {
          awsAccountId,
          reason,
          results,
          added: results.filter((r) => r.success && !r.alreadyPresent).length,
          alreadyPresent,
          failed,
        };
      }

      const text = summarize(output);
      const allFailed = output.failed === output.results.length;
      return allFailed ? { ...textResult(text, output), isError: true } : textResult(text, output);
    }
  );
}
