import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, errorResult, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const EmailCheckInputSchema = {
  domain: z
    .string()
    .min(3)
    .max(255)
    .describe(
      'The domain to check, as a bare name such as example.com. A URL, an email address or a name without a dot and a top-level domain fails.'
    ),
  quick: z
    .boolean()
    .optional()
    .describe(
      'Quick mode: fewer DKIM selectors and a smaller blacklist set. Skips the blacklist checks unless skipBlacklists is false.'
    ),
  skipBlacklists: z
    .boolean()
    .optional()
    .describe(
      'Skip the blacklist checks. Defaults to the value of quick. Send false together with quick to check the domain against 5 lists and its IPv4 mail servers against 10.'
    ),
  dkimSelector: z
    .string()
    .max(100)
    .optional()
    .describe('One DKIM selector to check, for example the selector a provider gave you.'),
  dkimSelectors: z
    .array(z.string().max(100))
    .optional()
    .describe(
      'Several DKIM selectors to check. Use this for providers that use random selectors, such as AWS SES.'
    ),
};

const EmailCheckOutputSchema = {
  domain: z.string(),
  checkedAt: z.string().optional().describe('When the check ran (ISO 8601).'),
  grade: z.string().optional().describe('Letter grade for the domain email setup.'),
  score: z.number().optional(),
  maxScore: z.number().optional(),
  issues: z
    .array(
      z.object({
        check: z.string(),
        reason: z.string(),
        points: z.number().describe('Points this issue cost the score.'),
        severity: z.string(),
      })
    )
    .describe('What cost points, most severe first as the API orders them.'),
  report: z
    .record(z.string(), z.unknown())
    .describe(
      'The full check result as the API returned it: spf, dkim, dmarc, mx, ipv6, reverseDns, domainAge, blacklist, bonuses and the rest.'
    ),
};

interface EmailCheckIssue {
  check: string;
  reason: string;
  points: number;
  severity: string;
}

interface EmailCheckApiResponse {
  success: boolean;
  error?: string;
  domain?: string;
  checkedAt?: string;
  score?: { grade: string; score: number; maxScore: number };
  issues?: EmailCheckIssue[];
  blacklist?: { summary?: { headline?: string } };
}

/**
 * Check a domain's email deliverability (SPF, DKIM, DMARC, MX, blacklists) and grade it.
 * Read-only. Calls `POST /tools/email-check`, which is public, so the request is sent without
 * the Wraps credential. Registered only when Wraps credentials are configured (D8).
 */
export function registerEmailCheck(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'email_check',
    {
      description:
        "Check a domain's email deliverability setup: SPF, DKIM, DMARC, MX records, reverse DNS, IPv6, domain registration and blacklist listings. Returns a grade, the issues that cost points, and the full report. Use it to find out why mail from a domain may fail authentication or land in spam. Read-only: it sends no mail and changes nothing. The route is public, so the request is sent WITHOUT your Wraps credential, but the tool is only registered when Wraps credentials are configured. Rate limited: 10 requests per minute and 100 per hour per IP. Over the limit, the call fails with HTTP 429; wait, then retry. Pagination: none. Truncation: nothing is cut; report holds the whole result. A domain the API rejects, such as one that is not a bare domain, returns isError with the reason and nothing is checked. For AWS SES, pass dkimSelectors, because SES uses random DKIM selectors.",
      inputSchema: EmailCheckInputSchema,
      outputSchema: EmailCheckOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }

      const res = await apiRequest<EmailCheckApiResponse>(resolved.api, {
        method: 'POST',
        path: '/tools/email-check',
        body: {
          domain: input.domain,
          quick: input.quick,
          skipBlacklists: input.skipBlacklists,
          dkimSelector: input.dkimSelector,
          dkimSelectors: input.dkimSelectors,
        },
        auth: false,
      });
      if (!res.ok) {
        return res.error;
      }

      // The route answers HTTP 200 with success: false for a bad domain or a failed check.
      if (res.data.success !== true) {
        const reason = res.data.error ?? 'the API did not give a reason';
        return errorResult(
          `The email check for ${input.domain} did not run: ${reason}. Nothing was checked. Pass a bare domain such as example.com and retry.`
        );
      }

      const data = res.data;
      const issues = data.issues ?? [];
      const grade = data.score?.grade;
      const scoreText = data.score
        ? `grade ${data.score.grade} (${data.score.score}/${data.score.maxScore})`
        : 'no grade returned';
      const issueLines = issues.map(
        (i) => `- ${i.check}: ${i.reason} (${i.severity}, ${i.points} points)`
      );
      const blacklistLine = data.blacklist?.summary?.headline
        ? `\nBlacklists: ${data.blacklist.summary.headline}`
        : '';
      const text = `Email check for ${data.domain ?? input.domain}: ${scoreText}. ${issues.length} issue(s).${issueLines.length > 0 ? `\n${issueLines.join('\n')}` : ''}${blacklistLine}`;

      return textResult(text, {
        domain: data.domain ?? input.domain,
        checkedAt: data.checkedAt,
        grade,
        score: data.score?.score,
        maxScore: data.score?.maxScore,
        issues,
        report: { ...(res.data as unknown as Record<string, unknown>) },
      });
    }
  );
}
