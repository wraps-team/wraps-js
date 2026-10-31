import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const RemoveSuppressionInput = {
  email: z
    .string()
    .min(1)
    .max(320)
    .describe(
      'The suppressed address to remove, exactly as SES stores it (for example jo@example.com).'
    ),
  awsAccountId: z
    .string()
    .min(1)
    .max(128)
    .describe(
      'Required. The Wraps id of the connected AWS account whose suppression list holds the address: a UUID from the account record (the awsAccountId field the domains and account-health routes return), NOT the 12-digit AWS account number. The API checks it belongs to this organization.'
    ),
  acknowledgedComplaint: z
    .boolean()
    .optional()
    .describe(
      'Set to true only when the user has agreed to remove an address that was suppressed because of a spam complaint. Without it, a COMPLAINT suppression is refused with a 409 and nothing changes.'
    ),
  confirm: confirmSchema,
};

const RemoveSuppressionOutput = z.object({
  id: z.string().describe('The removed address (the API resource id).'),
  email: z.string(),
  success: z.literal(true),
  wasPresent: z
    .boolean()
    .describe('false when the address was already gone from the list when the call ran.'),
});

/**
 * Remove one address from the SES suppression list so Wraps can send to it again. Writes and
 * destructive. Calls `DELETE /v1/suppressions/:email?awsAccountId=...&confirm=true`.
 */
export function registerRemoveSuppression(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'remove_suppression',
    {
      description:
        'Remove one address from the SES account-level suppression list of one AWS account, so Wraps sends to it again. Use this only after the user has agreed that the address is valid again. Lookup: to check whether an address is suppressed, and why, call list_suppressions with `email` first; this tool does not look up or list. Requires confirm: true. Irreversible: removing the suppression lets Wraps send to the address again, and a send to an address that bounces or complains again damages the sending reputation. Requires WRAPS_WRITE_ENABLED=true. Pagination: none; this removes a single record and makes one request. Truncation: not applicable, nothing is cut and hasMore is never set. A COMPLAINT suppression also needs acknowledgedComplaint: true, otherwise it is refused with a 409 and nothing changes.',
      inputSchema: RemoveSuppressionInput,
      outputSchema: RemoveSuppressionOutput,
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

      const result = await apiRequest<{
        success: true;
        email: string;
        wasPresent: boolean;
      }>(credential.api, {
        method: 'DELETE',
        path: `/v1/suppressions/${seg(input.email)}`,
        query: {
          awsAccountId: input.awsAccountId,
          confirm: 'true',
          acknowledgedComplaint: input.acknowledgedComplaint ? 'true' : undefined,
        },
      });
      if (!result.ok) {
        return result.error;
      }

      const { email, wasPresent } = result.data;
      return textResult(
        wasPresent
          ? `Removed ${email} from the suppression list of AWS account ${input.awsAccountId}. Wraps can send to it again.`
          : `${email} was already gone from the suppression list of AWS account ${input.awsAccountId}. Nothing else changed.`,
        { id: email, email, success: true as const, wasPresent }
      );
    }
  );
}
