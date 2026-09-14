import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrapsEmail } from '@wraps.dev/email';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';
import { requireAws } from '../config.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// SES caps PageSize at 1000. 100 is enough to answer "are there more than
// `limit`?" in a single round trip for any limit this tool accepts.
const PAGE_SIZE = 100;

// Bound on the follow-the-token walk. SES hands back a NextToken on the last
// non-empty page and only drops it on a trailing empty page (verified against a
// real account), so the walk can always need one page more than there is data.
const MAX_PAGES = 20;

const ListSuppressionsInputSchema = {
  email: z
    .string()
    .email()
    .optional()
    .describe(
      'Check this ONE address against SES and report whether it is suppressed. Use this for any "is <address> suppressed?" question: it is an exact lookup. Do NOT answer that question from the listing instead — the listing is paginated, so an address missing from it is not evidence the address is unsuppressed. `reason` and `limit` are ignored when this is set.'
    ),
  reason: z
    .enum(['BOUNCE', 'COMPLAINT'])
    .optional()
    .describe('Only list addresses suppressed for this reason.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(
      `Maximum number of addresses to list (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}). The response always states whether the listing was truncated.`
    ),
};

type SuppressionOutput = {
  mode: 'lookup' | 'list';
  suppressed?: boolean;
  entries: { email: string; reason: string; since: string }[];
  complete: boolean;
};

function textResult(text: string, structuredContent: SuppressionOutput) {
  return { content: [{ type: 'text' as const, text }], structuredContent };
}

/**
 * `complete` is the load-bearing field. A paged list that stopped early is not
 * proof an address is unsuppressed — only a `lookup` is. Agents branch on this
 * rather than inferring absence from `entries`.
 */
const ListSuppressionsOutputSchema = {
  mode: z
    .enum(['lookup', 'list'])
    .describe('lookup = exact single-address check; list = paged enumeration.'),
  suppressed: z
    .boolean()
    .optional()
    .describe('Only present for mode=lookup. Authoritative for that address.'),
  entries: z.array(
    z.object({
      email: z.string(),
      reason: z.string().describe('SES suppression reason, e.g. BOUNCE or COMPLAINT.'),
      since: z.string().describe('ISO 8601.'),
    })
  ),
  complete: z
    .boolean()
    .describe('False when SES reported more pages than were read; absence proves nothing.'),
};

export function registerListSuppressions(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_suppressions',
    {
      description:
        'List addresses on your AWS SES account-level suppression list, or check a single address with `email`. SES silently drops mail to suppressed addresses, and sending to them damages your sending reputation, so check before sending to an address you have not sent to recently. To determine whether one specific address is suppressed, always pass `email` — that is an exact lookup. The listing is paginated and states explicitly when it is truncated; a truncated listing is never proof that an address is unsuppressed. Optionally filter the listing by reason (BOUNCE or COMPLAINT).',
      inputSchema: ListSuppressionsInputSchema,
      outputSchema: ListSuppressionsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = await requireAws(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const { region } = resolved.aws;
      const email = new WrapsEmail({ region });
      try {
        if (input.email) {
          const entry = await email.suppression.get(input.email);
          if (!entry) {
            return textResult(
              `${input.email} is NOT on the SES suppression list. Checked directly against SES in ${region} — an exact lookup, not a page of results.`,
              { mode: 'lookup', suppressed: false, entries: [], complete: true }
            );
          }
          return textResult(
            [
              `${input.email} IS on the SES suppression list.`,
              `reason: ${entry.reason}`,
              `since: ${entry.lastUpdated.toISOString()}`,
              '',
              'SES will suppress a send to this address rather than deliver it. Remove it only if you have evidence the address is valid again.',
            ].join('\n'),
            {
              mode: 'lookup',
              suppressed: true,
              entries: [
                {
                  email: input.email,
                  reason: String(entry.reason),
                  since: entry.lastUpdated.toISOString(),
                },
              ],
              complete: true,
            }
          );
        }

        const limit = input.limit ?? DEFAULT_LIMIT;
        const entries: Awaited<ReturnType<typeof email.suppression.list>>['entries'] = [];
        let cursor: string | undefined;
        let reachedEnd = false;

        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await email.suppression.list({
            reason: input.reason,
            maxResults: PAGE_SIZE,
            continuationToken: cursor,
          });
          entries.push(...result.entries);
          cursor = result.nextToken;
          if (!cursor) {
            reachedEnd = true;
            break;
          }
          // One entry past the limit is all it takes to know the answer is
          // partial — no reason to walk the rest of a large suppression list.
          if (entries.length > limit) {
            break;
          }
        }

        const scope = input.reason ? ` with reason ${input.reason}` : '';

        if (entries.length === 0) {
          return textResult(
            reachedEnd
              ? `No suppressed addresses found${scope}. SES returned the complete list.`
              : `No suppressed addresses found${scope} in the first ${MAX_PAGES} pages, but SES reported more pages — this answer is incomplete.`,
            { mode: 'list', entries: [], complete: reachedEnd }
          );
        }

        const shown = entries.slice(0, limit);
        const rows = shown.map(
          (e) => `${e.email} — ${e.reason} (since ${e.lastUpdated.toISOString()})`
        );

        let footer: string;
        if (entries.length > limit) {
          footer = `\n\nShowing ${shown.length} suppressed addresses${scope}; more exist. Raise limit (max ${MAX_LIMIT}), filter by reason, or pass email=<address> to check one address exactly. Do not read this partial list as proof that an address is unsuppressed.`;
        } else if (reachedEnd) {
          footer = `\n\nShowing all ${shown.length} suppressed addresses${scope}.`;
        } else {
          footer = `\n\nShowing ${shown.length} suppressed addresses${scope}. SES still reported more pages after ${MAX_PAGES} requests, so this listing may be incomplete — pass email=<address> to check one address exactly.`;
        }

        return textResult(rows.join('\n') + footer, {
          mode: 'list',
          entries: shown.map((e) => ({
            email: e.email,
            reason: String(e.reason),
            since: e.lastUpdated.toISOString(),
          })),
          complete: reachedEnd && entries.length <= limit,
        });
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Failed to query the SES suppression list in ${region}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      } finally {
        email.destroy();
      }
    }
  );
}
