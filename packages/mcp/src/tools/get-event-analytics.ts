import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

/** Mirrors `analyticsSchema` in apps/api/src/routes/events-read.ts. */
interface AnalyticsResponse {
  totalEvents: number;
  eventsThisPeriod: number;
  activeContacts: number;
  avgEventsPerContact: number;
  dailyEvents: { date: string; count: number }[];
  topEventNames: { name: string; count: number }[];
}

const GetEventAnalyticsOutputSchema = {
  totalEvents: z.number().describe('Custom events recorded for the organization, all time.'),
  eventsThisPeriod: z.number().describe('Events in the last `days` days.'),
  activeContacts: z.number().describe('Distinct contacts with an event in the last `days` days.'),
  avgEventsPerContact: z.number().describe('eventsThisPeriod divided by activeContacts.'),
  dailyEvents: z
    .array(
      z.object({
        id: z.string().describe('The day, YYYY-MM-DD. Same value as date.'),
        date: z.string(),
        count: z.number().int(),
      })
    )
    .describe('One row per day in the window, zero-filled, oldest first.'),
  topEventNames: z
    .array(
      z.object({
        id: z.string().describe('The event name. Same value as name.'),
        name: z.string(),
        count: z.number().int(),
      })
    )
    .describe('The five most frequent event names in the window, most frequent first.'),
};

const GetEventAnalyticsInputSchema = {
  days: z
    .union([z.literal(7), z.literal(30)])
    .optional()
    .describe('Window in days: 7 or 30 (default 30).'),
  timezone: z
    .string()
    .max(64)
    .optional()
    .describe(
      'IANA timezone that sets the day boundaries, e.g. America/New_York (default UTC). An invalid name falls back to UTC.'
    ),
};

export function registerGetEventAnalytics(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_event_analytics',
    {
      description:
        'Get custom-event totals for this organization over the last 7 or 30 days: events in the period, active contacts, average events per contact, a zero-filled daily series, and the top event names. Use this for "how much event activity is there" questions; use list_events for individual events and list_event_names for the name catalogue. Pagination: none, this is a single aggregate per call. Truncation: topEventNames is capped at the top five names, and dailyEvents always has one row per day in the window. Read-only. Requires contacts:read.',
      inputSchema: GetEventAnalyticsInputSchema,
      outputSchema: GetEventAnalyticsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const res = await apiRequest<AnalyticsResponse>(resolved.api, {
        method: 'GET',
        path: '/v1/events/analytics',
        query: { days: input.days, timezone: input.timezone },
      });
      if (!res.ok) {
        return res.error;
      }
      const a = res.data;
      const structured = {
        totalEvents: a.totalEvents,
        eventsThisPeriod: a.eventsThisPeriod,
        activeContacts: a.activeContacts,
        avgEventsPerContact: a.avgEventsPerContact,
        dailyEvents: a.dailyEvents.map((d) => ({ id: d.date, date: d.date, count: d.count })),
        topEventNames: a.topEventNames.map((n) => ({ id: n.name, name: n.name, count: n.count })),
      };
      const window = input.days ?? 30;
      return textResult(
        `Last ${window} days: ${a.eventsThisPeriod} events from ${a.activeContacts} active contacts (${a.avgEventsPerContact} per contact). ${a.totalEvents} events in total.`,
        structured
      );
    }
  );
}
