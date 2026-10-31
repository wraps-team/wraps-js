import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const MAX_PAGE_SIZE = 100;
const EMAIL_STATUSES = [
  'active',
  'unsubscribed',
  'bounced',
  'soft_bounced',
  'complained',
  'suppressed',
] as const;
const SMS_STATUSES = ['pending_consent', 'opted_in', 'opted_out', 'invalid'] as const;

/**
 * One contact as the API returns it from GET /v1/contacts. Shared with get_contact,
 * create_contact and update_contact: the same record comes back from all four routes.
 */
export const contactRecordShape = {
  id: z
    .string()
    .describe(
      'Contact id (UUID). Pass it to get_contact, update_contact, set_contact_topics or delete_contact.'
    ),
  externalId: z.string().nullable().describe('Your own id for this contact, if you set one.'),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  company: z.string().nullable(),
  jobTitle: z.string().nullable(),
  emailStatus: z
    .string()
    .nullable()
    .describe('Email subscription status, e.g. active, unsubscribed, bounced, suppressed.'),
  smsStatus: z
    .string()
    .nullable()
    .describe('SMS consent status, e.g. pending_consent, opted_in, opted_out.'),
  preferredChannel: z.string().nullable().describe('email or sms, or null when not set.'),
  properties: z.record(z.string(), z.unknown()).describe('Custom properties set on the contact.'),
  emailsSent: z.number(),
  emailsOpened: z.number(),
  emailsClicked: z.number(),
  smsSent: z.number(),
  smsClicked: z.number(),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
};

export const ContactRecordSchema = z.object(contactRecordShape);
export type ContactRecord = z.infer<typeof ContactRecordSchema>;

const ListContactsInputSchema = {
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Page to read, 1-indexed. Default 1. Pagination: to continue, call again with page set to the page returned plus 1 while hasMore is true.'
    ),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(
      `Contacts per page. Default 50, max ${MAX_PAGE_SIZE} (larger values are capped by the API).`
    ),
  emailStatus: z.enum(EMAIL_STATUSES).optional().describe('Only contacts with this email status.'),
  smsStatus: z.enum(SMS_STATUSES).optional().describe('Only contacts with this SMS status.'),
  preferredChannel: z
    .enum(['email', 'sms'])
    .optional()
    .describe('Only contacts whose preferred channel is this.'),
  search: z
    .string()
    .max(255)
    .optional()
    .describe('Case-insensitive text match against email or phone.'),
};

const ListContactsOutputSchema = {
  contacts: z.array(ContactRecordSchema),
  total: z.number().describe('Total contacts matching the filters, across all pages.'),
  page: z.number().describe('The page this response holds.'),
  pageSize: z.number(),
  totalPages: z.number(),
  hasMore: z
    .boolean()
    .describe(
      'True when a later page exists. Continue with page = page + 1. False means this is the last page.'
    ),
};

interface ListContactsApiResponse {
  contacts: ContactRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function registerListContacts(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_contacts',
    {
      description:
        'List contacts in your Wraps organization, optionally filtered by email status, SMS status, preferred channel, or a search string on email or phone. Use it to browse or to find contacts that match a filter. To look up one contact you already know (by id, email or externalId), use get_contact instead: it is an exact lookup, while this list is a filtered page. Pagination: results are paginated. Pass page (1-indexed) and pageSize (max 100, default 50). While hasMore is true, call again with page set to the returned page plus 1. Truncation: each page is a slice of total, and pageSize is capped at 100. A filtered list with hasMore false is complete; a page with hasMore true is not proof that a contact is absent from the rest.',
      inputSchema: ListContactsInputSchema,
      outputSchema: ListContactsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const res = await apiRequest<ListContactsApiResponse>(resolved.api, {
        method: 'GET',
        path: '/v1/contacts',
        query: {
          page: input.page,
          pageSize: input.pageSize,
          emailStatus: input.emailStatus,
          smsStatus: input.smsStatus,
          preferredChannel: input.preferredChannel,
          search: input.search,
        },
      });
      if (!res.ok) {
        return res.error;
      }

      const body = res.data;
      const hasMore = body.page < body.totalPages;
      const rows = body.contacts.map(
        (c) =>
          `- ${c.email ?? c.phone ?? '(no email or phone)'} (id ${c.id}, email status ${c.emailStatus ?? 'none'})`
      );
      const footer = hasMore
        ? `\n\nPage ${body.page} of ${body.totalPages}; more contacts exist. Call again with page=${body.page + 1} to continue.`
        : `\n\nPage ${body.page} of ${body.totalPages}; this is the last page.`;
      const head =
        body.contacts.length === 0
          ? `No contacts match on page ${body.page} (total ${body.total}).`
          : `${body.contacts.length} of ${body.total} matching contacts:`;

      return textResult(`${head}\n${rows.join('\n')}${footer}`, {
        contacts: body.contacts,
        total: body.total,
        page: body.page,
        pageSize: body.pageSize,
        totalPages: body.totalPages,
        hasMore,
      });
    }
  );
}
