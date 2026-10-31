import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';

const Address = z.object({ address: z.string(), name: z.string() });

const Attachment = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  s3Key: z.string().describe('Storage key of the attachment. Metadata only: there is no download.'),
  contentDisposition: z.string().nullable(),
  cid: z.string().nullable(),
});

/** The route's detail response. `emailId` is the id; `id` is added for the output. */
const RouteDetail = z.object({
  awsAccountId: z.string(),
  emailId: z.string(),
  messageId: z.string(),
  from: Address,
  to: z.array(Address),
  cc: z.array(Address),
  subject: z.string(),
  date: z.string(),
  html: z.string().nullable(),
  htmlTruncated: z.boolean(),
  text: z.string().nullable(),
  headers: z.record(z.string(), z.unknown()),
  attachments: z.array(Attachment),
  spamVerdict: z.string().nullable(),
  virusVerdict: z.string().nullable(),
  rawS3Key: z.string(),
  receivedAt: z.string(),
});

const GetInboundEmailInput = {
  emailId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .describe('The emailId from a list_inbound_emails entry.'),
  awsAccountId: z
    .string()
    .max(128)
    .optional()
    .describe(
      'The awsAccountId from the same list_inbound_emails entry (Wraps account UUID, not the 12-digit AWS number). Pass it: without it every account is tried in order and the first match is returned, which can differ from the email you meant when ids repeat across accounts.'
    ),
};

const GetInboundEmailOutput = RouteDetail.extend({
  id: z
    .string()
    .describe('Same as emailId. Pair it with awsAccountId; the id is unique per account.'),
  headers: z
    .record(z.string(), z.unknown())
    .describe('Message headers as parsed from the stored email.'),
  attachments: z
    .array(Attachment)
    .describe('Attachment metadata only. Contents cannot be downloaded through the API.'),
  htmlTruncated: z
    .boolean()
    .describe(
      'True when the HTML body was longer than the ~200 KB cap at receipt, so html is only a prefix and may be incomplete markup. Prefer text when html is truncated.'
    ),
});

/**
 * Read one inbound email. Read-only. Calls `GET /v1/email/inbound/{emailId}`, which returns a
 * single record. A 404 is not proof of absence when the list reported denied accounts.
 */
export function registerGetInboundEmail(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_inbound_email',
    {
      description:
        "Get one parsed inbound email from the customer's SES inbound bucket by emailId, with its from/to/cc, subject, date, headers, text body, HTML body and attachment metadata. Use this after list_inbound_emails to read one email; it returns a single record, not a list, so there is no pagination and no cursor. Pass the awsAccountId from the list entry to read from that account only. Truncation: html is cut at receipt to a prefix of about 200 KB; when htmlTruncated is true the markup may be incomplete, so read text as well. html is null when the email had no HTML part. Attachments are metadata only (filename, contentType, size, s3Key); the API cannot download attachment contents. A 404 means the email is not in any account this key could read, or the awsAccountId is not in this organization. Accounts that deny access are skipped on this lookup, so a 404 is not proof the email is absent if list_inbound_emails reported deniedAccountIds or unreachableAccountIds.",
      inputSchema: GetInboundEmailInput,
      outputSchema: GetInboundEmailOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }
      const result = await apiRequest<z.infer<typeof RouteDetail>>(credential.api, {
        method: 'GET',
        path: `/v1/email/inbound/${seg(input.emailId)}`,
        query: { awsAccountId: input.awsAccountId },
      });
      if (!result.ok) {
        return result.error;
      }
      const email = RouteDetail.parse(result.data);
      const lines = [
        `Inbound email "${email.subject}" from ${email.from.address}, received ${email.receivedAt}.`,
        `${email.attachments.length} attachment${email.attachments.length === 1 ? '' : 's'} (metadata only).`,
      ];
      if (email.htmlTruncated) {
        lines.push(
          'The HTML body was truncated at receipt (about 200 KB), so the HTML may be incomplete. Use text if present.'
        );
      }
      return textResult(lines.join('\n'), { ...email, id: email.emailId });
    }
  );
}
