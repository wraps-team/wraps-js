import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
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

const CreateContactInputSchema = {
  externalId: z
    .string()
    .max(255)
    .optional()
    .describe(
      'Your own id for this contact (e.g. your user id). Must be unique in the organization.'
    ),
  email: z.email().max(255).optional().describe('Email address. Give email, phone, or both.'),
  phone: z.string().max(50).optional().describe('Phone number. Give email, phone, or both.'),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  company: z.string().max(200).optional(),
  jobTitle: z.string().max(200).optional(),
  emailStatus: z
    .enum(EMAIL_STATUSES)
    .optional()
    .describe('Email subscription status. Leave unset for the API default.'),
  smsStatus: z.enum(SMS_STATUSES).optional().describe('SMS consent status.'),
  preferredChannel: z.enum(['email', 'sms']).optional(),
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Custom properties, stored as given.'),
  topicIds: z
    .array(z.string().max(36))
    .optional()
    .describe('Topic ids to subscribe the new contact to. Use this or topicSlugs, or both.'),
  topicSlugs: z
    .array(z.string().max(100))
    .optional()
    .describe('Topic slugs to subscribe the new contact to.'),
};

const CreateContactOutputSchema = {
  ...contactRecordShape,
  pendingTopics: z
    .array(z.string())
    .optional()
    .describe(
      'Topic ids that need double opt-in. They are not active until the contact confirms, and a confirmation email was sent. Absent when none are pending.'
    ),
};

interface CreateContactApiResponse extends ContactRecord {
  pendingTopics?: string[];
}

export function registerCreateContact(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'create_contact',
    {
      description:
        'Create one new contact. Use it when the person is not in the organization yet; to change a contact that exists, use update_contact, and to replace its topic subscriptions, use set_contact_topics. Give at least one of email or phone. A duplicate externalId, email, or phone is refused with a 409 that names the field. Topics that use double opt-in are returned in pendingTopics: they are not active until the contact confirms, and a confirmation email is sent. Pagination does not apply: the response is a single record. Truncation: nothing is truncated. Writes are gated: this needs WRAPS_WRITE_ENABLED=true.',
      inputSchema: CreateContactInputSchema,
      outputSchema: CreateContactOutputSchema,
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
      const res = await apiRequest<CreateContactApiResponse>(resolved.api, {
        method: 'POST',
        path: '/v1/contacts',
        body: input,
      });
      if (!res.ok) {
        return res.error;
      }

      const contact = res.data;
      const label = contact.email ?? contact.phone ?? contact.id;
      const pending = contact.pendingTopics ?? [];
      const pendingNote =
        pending.length > 0
          ? ` ${pending.length} topic(s) await the contact's confirmation (pendingTopics).`
          : '';

      return textResult(`Created contact ${label} (id ${contact.id}).${pendingNote}`, {
        ...contact,
        ...(pending.length > 0 ? { pendingTopics: pending } : {}),
      });
    }
  );
}
