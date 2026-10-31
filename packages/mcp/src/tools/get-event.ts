import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

/** Mirrors `eventSchema` in apps/api/src/routes/events-read.ts. */
const GetEventOutputSchema = {
  id: z.string().describe('Event id.'),
  eventName: z.string(),
  eventData: z
    .record(z.string(), z.unknown())
    .nullable()
    .describe('Properties the event was tracked with, as stored. Not truncated.'),
  createdAt: z.string().describe('ISO 8601 time the event was recorded.'),
  contactId: z.string().describe('Use with the contacts tools to read the contact.'),
  contactEmail: z.string().nullable(),
  contactFirstName: z.string().nullable(),
  contactLastName: z.string().nullable(),
};

const GetEventInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('The event id, from list_events or a previous track_event lookup.'),
};

export function registerGetEvent(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_event',
    {
      description:
        'Get one custom event by id: its name, properties, time, and the contact it belongs to. Returns a single record, not a list. Use list_events to find events by name, contact, or date, then pass the event id here when you need this one event in full. Pagination: none, because this returns a single record. Truncation: nothing is truncated; eventData is returned as stored. Returns an error if the event does not exist in this organization. Read-only. Requires contacts:read.',
      inputSchema: GetEventInputSchema,
      outputSchema: GetEventOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const res = await apiRequest<z.infer<z.ZodObject<typeof GetEventOutputSchema>>>(
        resolved.api,
        { method: 'GET', path: `/v1/events/${seg(input.id)}` }
      );
      if (!res.ok) {
        return res.error;
      }
      const event = res.data;
      return textResult(
        `Event ${event.id}: ${event.eventName} for contact ${event.contactId} at ${event.createdAt}.`,
        event
      );
    }
  );
}
