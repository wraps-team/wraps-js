import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

/** Rows this tool returns per call. The API's own cap (50,000) is larger; see the description. */
const MAX_ROWS = 1000;
const PRINTED_ROWS = 20;
const API_ROW_CAP = 50_000;
const EMAIL_STATUSES = [
  'active',
  'unsubscribed',
  'bounced',
  'soft_bounced',
  'complained',
  'suppressed',
] as const;

const ExportedContactSchema = z.object({
  id: z.string().describe('Contact id (UUID).'),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  company: z.string().nullable(),
  jobTitle: z.string().nullable(),
  emailStatus: z.string().nullable().describe('Email subscription status.'),
  emailSoftBounceCount: z.number(),
  smsStatus: z.string().nullable(),
  properties: z.record(z.string(), z.unknown()),
  createdAt: z.unknown().describe('ISO 8601 timestamp.'),
  updatedAt: z.unknown().describe('ISO 8601 timestamp.'),
  topics: z
    .array(
      z.object({
        topicId: z.string(),
        topicName: z.string(),
        status: z.string(),
      })
    )
    .describe('Topic subscriptions of the contact.'),
});

const ExportContactsInputSchema = {
  search: z
    .string()
    .max(255)
    .optional()
    .describe('Only contacts whose email contains this text (case-insensitive).'),
  emailStatus: z.enum(EMAIL_STATUSES).optional().describe('Only contacts with this email status.'),
  topicId: z
    .string()
    .max(36)
    .optional()
    .describe('Only contacts actively subscribed to this topic. The id comes from list_topics.'),
};

const ExportContactsOutputSchema = {
  contacts: z
    .array(ExportedContactSchema)
    .describe(`The matching contacts, newest first, at most ${MAX_ROWS}.`),
  total: z
    .number()
    .describe('How many contacts match the filters in total, across the whole organization.'),
  returned: z.number().describe('How many rows are in contacts.'),
  truncated: z
    .boolean()
    .describe(
      'True when fewer rows are in contacts than match (total). Narrow the filters and call again to reach the rest.'
    ),
};

interface ExportApiResponse {
  contacts: z.infer<typeof ExportedContactSchema>[];
  total: number;
  truncated: boolean;
}

/**
 * Export the contacts that match the filters, newest first, capped at `MAX_ROWS` rows per call.
 * Read-only. Calls `GET /v1/contacts/export?format=json`, the route's JSON form, because the CSV
 * form is not JSON and `apiRequest` cannot parse it.
 */
export function registerExportContacts(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'export_contacts',
    {
      description: `Export the contacts in your Wraps organization that match optional filters (search on email, emailStatus, or a topic they are subscribed to), newest first, as structured rows. Use it to pull a list for review or analysis. To look up one known contact, use get_contact. To browse with paging, use list_contacts. Requires the contacts export permission (contacts:read for API keys). Pagination: none. There is no page or cursor. Truncation: at most ${MAX_ROWS} rows come back per call, in structuredContent.contacts. total is the real number of matching contacts. truncated is true whenever the rows returned are fewer than the matches, which covers both this tool's ${MAX_ROWS}-row cap and the API's own ${API_ROW_CAP}-row cap. When truncated is true, nothing else is paged: narrow the filters (search, emailStatus, topicId) until total is at most ${MAX_ROWS}, then call again. Do not treat a truncated result as the full list.`,
      inputSchema: ExportContactsInputSchema,
      outputSchema: ExportContactsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const res = await apiRequest<ExportApiResponse>(resolved.api, {
        method: 'GET',
        path: '/v1/contacts/export',
        query: {
          format: 'json',
          search: input.search,
          emailStatus: input.emailStatus,
          topicId: input.topicId,
        },
      });
      if (!res.ok) {
        return res.error;
      }

      const contacts = res.data.contacts.slice(0, MAX_ROWS);
      const total = res.data.total;
      const truncated = res.data.truncated || total > contacts.length;

      const head =
        total === 0
          ? 'No contacts match these filters (total 0).'
          : `Exported ${contacts.length} of ${total} matching contact(s), newest first.`;
      const rows = contacts
        .slice(0, PRINTED_ROWS)
        .map(
          (c) =>
            `- ${c.email ?? c.phone ?? '(no email or phone)'} (id ${c.id}, email status ${c.emailStatus ?? 'none'})`
        );
      const moreRows =
        contacts.length > PRINTED_ROWS
          ? `\n...and ${contacts.length - PRINTED_ROWS} more rows in structuredContent.contacts.`
          : '';

      let truncationNote = '';
      if (truncated) {
        const reasons: string[] = [];
        if (res.data.truncated) {
          reasons.push(`the API holds at most ${API_ROW_CAP} matching rows`);
        }
        if (total > contacts.length) {
          reasons.push(`this tool returns at most ${MAX_ROWS} rows per call`);
        }
        truncationNote = `\n\nTruncated: ${reasons.join(' and ')}, so ${total - contacts.length} matching contact(s) are not in this result. Narrow search, emailStatus or topicId and call again.`;
      }

      return textResult(
        `${head}${rows.length > 0 ? `\n${rows.join('\n')}` : ''}${moreRows}${truncationNote}`,
        {
          contacts,
          total,
          returned: contacts.length,
          truncated,
        }
      );
    }
  );
}
