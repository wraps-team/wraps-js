import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const Address = z.object({ address: z.string(), name: z.string() });

/** One entry as the route returns it. `emailId` is the id get_inbound_email takes. */
const RouteSummary = z.object({
  awsAccountId: z.string(),
  emailId: z.string(),
  from: Address,
  to: z.array(Address),
  subject: z.string(),
  receivedAt: z.string(),
  hasAttachments: z.boolean(),
  attachmentCount: z.number(),
  spamVerdict: z.string().nullable(),
  virusVerdict: z.string().nullable(),
});

const RouteListResponse = z.object({
  data: z.array(RouteSummary),
  nextCursor: z.string().nullable(),
  deniedAccountIds: z.array(z.string()),
  unreachableAccountIds: z.array(z.string()),
});

const ListInboundEmailsInput = {
  awsAccountId: z
    .string()
    .max(128)
    .optional()
    .describe(
      'Limit the listing to one connected AWS account, by its Wraps account UUID (not the 12-digit AWS account number). Omit to read every account in the organization. An id that is not in this organization returns an error.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(
      `Entries per page (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}). A page can hold fewer entries than this, or none, because non-email objects are skipped.`
    ),
  cursor: z
    .string()
    .max(8192)
    .optional()
    .describe(
      'Pass the nextCursor from the previous page, unchanged, to read the next page. Omit for the first page. Use the same awsAccountId with it that the previous page used.'
    ),
};

const InboundEmailSummary = RouteSummary.extend({
  id: z
    .string()
    .describe(
      'The email id (same as emailId). Only unique within one awsAccountId, so pair it with awsAccountId.'
    ),
});

const ListInboundEmailsOutput = z.object({
  emails: z.array(InboundEmailSummary),
  nextCursor: z
    .string()
    .nullable()
    .describe('Pass as cursor to get the next page. Null on the last page.'),
  deniedAccountIds: z
    .array(z.string())
    .describe(
      'Accounts that refused access and were skipped. Non-empty means the listing is incomplete.'
    ),
  unreachableAccountIds: z
    .array(z.string())
    .describe(
      'Accounts that could not be read and were skipped. Non-empty means the listing is incomplete.'
    ),
});

/**
 * List one page of inbound emails. Read-only. Calls `GET /v1/email/inbound`. Pagination is
 * cursor-based: the route can return an empty page while `nextCursor` is set, so the agent
 * must keep following `nextCursor` until it is null.
 */
export function registerListInboundEmails(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_inbound_emails',
    {
      description:
        "List one page of parsed inbound emails that the customer's SES inbound bucket received, across the organization's connected AWS accounts. Use this to find an email (its emailId and awsAccountId), then get_inbound_email to read its body, headers and attachment metadata. Results come in S3 key order (the storage key), not received time, so the newest email is not necessarily first; compare receivedAt yourself if you need recency. Pagination: pass nextCursor back unchanged as cursor to read the next page, and keep going while nextCursor is not null; it is null on the last page. A page can be empty, or hold fewer than limit entries, while nextCursor is still set, so an empty page is not the end. Optional awsAccountId limits the listing to one account (Wraps account UUID); a page can span accounts, and each entry carries its awsAccountId. Truncation: limit defaults to 20 and is capped at 100 per page. The list carries only hasAttachments and attachmentCount; attachment contents cannot be downloaded through the API. deniedAccountIds lists accounts that refused access and unreachableAccountIds lists accounts that could not be read; when either is non-empty the listing is incomplete, so an email missing from it is not proof it was never received.",
      inputSchema: ListInboundEmailsInput,
      outputSchema: ListInboundEmailsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }
      const result = await apiRequest<z.infer<typeof RouteListResponse>>(credential.api, {
        method: 'GET',
        path: '/v1/email/inbound',
        query: {
          awsAccountId: input.awsAccountId,
          limit: input.limit,
          cursor: input.cursor,
        },
      });
      if (!result.ok) {
        return result.error;
      }
      const page = RouteListResponse.parse(result.data);
      const emails = page.data.map((email) => ({ id: email.emailId, ...email }));

      const lines = [
        `Returned ${emails.length} inbound email${emails.length === 1 ? '' : 's'} on this page.`,
      ];
      if (page.nextCursor !== null) {
        lines.push(
          `More pages exist: call again with cursor set to nextCursor (${page.nextCursor}). An empty page can still have more.`
        );
      } else {
        lines.push('This is the last page (nextCursor is null).');
      }
      if (page.deniedAccountIds.length > 0) {
        lines.push(
          `Skipped accounts that denied access: ${page.deniedAccountIds.join(', ')}. The listing is incomplete for them.`
        );
      }
      if (page.unreachableAccountIds.length > 0) {
        lines.push(
          `Skipped accounts that could not be read: ${page.unreachableAccountIds.join(', ')}. The listing is incomplete for them.`
        );
      }

      return textResult(lines.join('\n'), {
        emails,
        nextCursor: page.nextCursor,
        deniedAccountIds: page.deniedAccountIds,
        unreachableAccountIds: page.unreachableAccountIds,
      });
    }
  );
}
