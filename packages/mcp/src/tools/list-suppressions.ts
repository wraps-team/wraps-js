import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrapsEmail } from '@wraps.dev/email';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';

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

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function registerListSuppressions(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_suppressions',
    {
      description:
        'List addresses on your AWS SES account-level suppression list, or check a single address with `email`. SES silently drops mail to suppressed addresses, and sending to them damages your sending reputation, so check before sending to an address you have not sent to recently. To determine whether one specific address is suppressed, always pass `email` — that is an exact lookup. The listing is paginated and states explicitly when it is truncated; a truncated listing is never proof that an address is unsuppressed. Optionally filter the listing by reason (BOUNCE or COMPLAINT).',
      inputSchema: ListSuppressionsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const email = new WrapsEmail({ region: config.region });
      try {
        if (input.email) {
          const entry = await email.suppression.get(input.email);
          if (!entry) {
            return textResult(
              `${input.email} is NOT on the SES suppression list. Checked directly against SES in ${config.region} — an exact lookup, not a page of results.`
            );
          }
          return textResult(
            [
              `${input.email} IS on the SES suppression list.`,
              `reason: ${entry.reason}`,
              `since: ${entry.lastUpdated.toISOString()}`,
              '',
              'SES will suppress a send to this address rather than deliver it. Remove it only if you have evidence the address is valid again.',
            ].join('\n')
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
              : `No suppressed addresses found${scope} in the first ${MAX_PAGES} pages, but SES reported more pages — this answer is incomplete.`
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

        return textResult(rows.join('\n') + footer);
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Failed to query the SES suppression list in ${config.region}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      } finally {
        email.destroy();
      }
    }
  );
}
