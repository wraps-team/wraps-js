import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** Mirrors `eventSchema` in apps/api/src/routes/events-read.ts. */
const EventRecordSchema = z.object({
  id: z.string().describe('Event id. Pass it to get_event for this one event.'),
  eventName: z.string(),
  eventData: z
    .record(z.string(), z.unknown())
    .nullable()
    .describe('Properties the event was tracked with, as stored. Not truncated.'),
  createdAt: z.string().describe('ISO 8601 time the event was recorded.'),
  contactId: z.string(),
  contactEmail: z.string().nullable(),
  contactFirstName: z.string().nullable(),
  contactLastName: z.string().nullable(),
});

const ListEventsOutputSchema = {
  events: z.array(EventRecordSchema).describe('This page only, newest first.'),
  total: z.number().int().describe('Events matching the filters across all pages.'),
  page: z.number().int().describe('The page returned (1-indexed).'),
  pageSize: z.number().int().describe('Events per page used for this response.'),
  hasMore: z
    .boolean()
    .describe('True when more events exist beyond this page. Call again with page + 1.'),
};

const ListEventsInputSchema = {
  page: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .optional()
    .describe('Page number, 1-indexed (default 1). For the next page, pass the previous page + 1.'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(`Events per page (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}).`),
  eventName: z
    .string()
    .max(255)
    .optional()
    .describe(
      "Exact event name to match, e.g. 'purchase.completed'. Use list_event_names to find names."
    ),
  search: z
    .string()
    .max(255)
    .optional()
    .describe('Case-insensitive match on event name, event data, or contact name or email.'),
  contactEmail: z
    .string()
    .max(255)
    .optional()
    .describe('Case-insensitive match on the contact email.'),
  dateFrom: z
    .string()
    .optional()
    .describe('ISO 8601 lower bound on createdAt, e.g. 2026-01-31T00:00:00Z.'),
  dateTo: z.string().optional().describe('ISO 8601 upper bound on createdAt.'),
};

export function registerListEvents(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_events',
    {
      description:
        'List custom events tracked for this Wraps organization, newest first, optionally filtered by event name, contact, text search, or date range. Use this to answer "what events happened" or "did contact X do Y"; use get_event when you already have an event id, and list_event_names to discover event names. Pagination: this is paginated. Pass page (1-indexed) and pageSize (1-100, default 50); when hasMore is true, call again with page + 1 to continue. Truncation: each response is capped at one page; a page is not proof that nothing else matches, so keep going while hasMore is true before concluding absence. Read-only. Requires contacts:read.',
      inputSchema: ListEventsInputSchema,
      outputSchema: ListEventsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const res = await apiRequest<{
        events: z.infer<typeof EventRecordSchema>[];
        total: number;
        page: number;
        pageSize: number;
      }>(resolved.api, {
        method: 'GET',
        path: '/v1/events',
        query: {
          page: input.page,
          pageSize: input.pageSize,
          eventName: input.eventName,
          search: input.search,
          contactEmail: input.contactEmail,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
        },
      });
      if (!res.ok) {
        return res.error;
      }
      const { events, total, page, pageSize } = res.data;
      const hasMore = page * pageSize < total;
      const text =
        events.length === 0
          ? `No events matched on page ${page}. total: ${total}. hasMore: ${hasMore}.`
          : `Returned ${events.length} of ${total} matching events (page ${page}, pageSize ${pageSize}). hasMore: ${hasMore}.${hasMore ? ` Call again with page ${page + 1} to continue.` : ''}`;
      return textResult(text, {
        events,
        total,
        page,
        pageSize,
        hasMore,
      });
    }
  );
}
