import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';
import { type ContactRecord, contactRecordShape } from './list-contacts.ts';

const EMAIL_STATUSES = [
  'active',
  'unsubscribed',
  'bounced',
  'soft_bounced',
  'complained',
  'suppressed',
] as const;
const SMS_STATUSES = ['pending_consent', 'opted_in', 'opted_out', 'invalid'] as const;

const UpdateContactInputSchema = {
  id: z
    .string()
    .min(1)
    .max(255)
    .describe('The contact to change: its UUID, its email address, or your externalId.'),
  externalId: z
    .string()
    .max(255)
    .nullable()
    .optional()
    .describe(
      'Your own id for this contact. Must stay unique in the organization. null clears it.'
    ),
  email: z
    .email()
    .max(255)
    .optional()
    .describe('New email address. Cannot be cleared; omit to keep it.'),
  phone: z
    .string()
    .max(50)
    .optional()
    .describe('New phone number. Cannot be cleared; omit to keep it.'),
  firstName: z.string().max(100).nullable().optional().describe('null clears it.'),
  lastName: z.string().max(100).nullable().optional().describe('null clears it.'),
  company: z.string().max(200).nullable().optional().describe('null clears it.'),
  jobTitle: z.string().max(200).nullable().optional().describe('null clears it.'),
  emailStatus: z.enum(EMAIL_STATUSES).optional().describe('Email subscription status.'),
  smsStatus: z.enum(SMS_STATUSES).optional().describe('SMS consent status.'),
  preferredChannel: z
    .enum(['email', 'sms'])
    .nullable()
    .optional()
    .describe('Preferred channel. null clears it.'),
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Custom properties. Sent as given, so check the result before relying on a merge.'),
  topicIds: z
    .array(z.string().max(36))
    .optional()
    .describe(
      'Topic ids to ADD. Existing subscriptions are kept. Use set_contact_topics to replace the list.'
    ),
  topicSlugs: z
    .array(z.string().max(100))
    .optional()
    .describe('Topic slugs to ADD. Existing subscriptions are kept.'),
};

const UpdateContactOutputSchema = {
  ...contactRecordShape,
  pendingTopics: z
    .array(z.string())
    .optional()
    .describe(
      'Topic ids newly added that need double opt-in. They are not active until the contact confirms. Absent when none are pending.'
    ),
};

interface UpdateContactApiResponse extends ContactRecord {
  pendingTopics?: string[];
}

export function registerUpdateContact(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'update_contact',
    {
      description:
        'Change one existing contact. Pass the contact id (UUID, email, or externalId) and only the fields that should change; omitted fields are left alone, and null clears the nullable ones (externalId, firstName, lastName, company, jobTitle, preferredChannel). Topic arguments ADD subscriptions and keep the rest: to replace the whole topic list, use set_contact_topics. A 409 means another contact already has that externalId, email, or phone, or a topic is already subscribed. Pagination does not apply: the response is a single record. Truncation: nothing is truncated. Writes are gated: this needs WRAPS_WRITE_ENABLED=true.',
      inputSchema: UpdateContactInputSchema,
      outputSchema: UpdateContactOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const gated = requireWrite(config);
      if (gated) {
        return gated;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const { id, ...body } = input;
      const res = await apiRequest<UpdateContactApiResponse>(resolved.api, {
        method: 'PATCH',
        path: `/v1/contacts/${seg(id)}`,
        body,
      });
      if (!res.ok) {
        return res.error;
      }

      const contact = res.data;
      const label = contact.email ?? contact.phone ?? contact.id;
      const pending = contact.pendingTopics ?? [];
      const pendingNote =
        pending.length > 0
          ? ` ${pending.length} newly added topic(s) await the contact's confirmation (pendingTopics).`
          : '';

      return textResult(`Updated contact ${label} (id ${contact.id}).${pendingNote}`, {
        ...contact,
        ...(pending.length > 0 ? { pendingTopics: pending } : {}),
      });
    }
  );
}
