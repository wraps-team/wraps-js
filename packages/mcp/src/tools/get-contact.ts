import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { type ContactRecord, contactRecordShape } from './list-contacts.ts';

interface ContactTopicApi {
  topicId: string;
  topicName: string;
  status: string;
  subscribedAt: string | null;
}

interface GetContactApiResponse extends ContactRecord {
  topics: ContactTopicApi[];
}

const GetContactInputSchema = {
  id: z
    .string()
    .min(1)
    .max(255)
    .describe(
      'The contact to read: its UUID, its email address, or your externalId. Use the id returned by list_contacts when you have it.'
    ),
};

const GetContactOutputSchema = {
  ...contactRecordShape,
  topics: z
    .array(
      z.object({
        topicId: z.string(),
        topicName: z.string(),
        status: z.string().describe('Subscription status for this topic.'),
        subscribedAt: z.string().nullable().describe('ISO 8601, or null if not subscribed yet.'),
      })
    )
    .describe('Every topic subscription on this contact, with its status.'),
};

export function registerGetContact(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_contact',
    {
      description:
        'Get one contact in full, including its topic subscriptions. Use it when you already know which contact you need, identified by UUID, email address, or externalId. It returns a single record, not a page. For browsing or filtering contacts, use list_contacts. Pagination does not apply: the response is one record. Truncation: nothing is truncated; topics lists every subscription on the contact. A 404 means no contact in this organization matches that id.',
      inputSchema: GetContactInputSchema,
      outputSchema: GetContactOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const res = await apiRequest<GetContactApiResponse>(resolved.api, {
        method: 'GET',
        path: `/v1/contacts/${seg(input.id)}`,
      });
      if (!res.ok) {
        return res.error;
      }

      const contact = res.data;
      const label = contact.email ?? contact.phone ?? contact.id;
      const topicLines = contact.topics.map((t) => `- ${t.topicName}: ${t.status}`);
      const text = [
        `Contact ${label} (id ${contact.id}), email status ${contact.emailStatus ?? 'none'}, SMS status ${contact.smsStatus ?? 'none'}.`,
        topicLines.length > 0 ? 'Topics:' : 'No topic subscriptions.',
        ...topicLines,
      ].join('\n');

      return textResult(text, { ...contact });
    }
  );
}
