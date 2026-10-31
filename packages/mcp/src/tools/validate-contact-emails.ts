import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const MAX_ADDRESSES = 100;

const VERDICTS = ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const;

const ValidateContactEmailsInputSchema = {
  awsAccountId: z
    .string()
    .min(1)
    .max(36)
    .describe(
      'Id of an AWS account connected to this organization whose SES plan is PRO or ENTERPRISE. The check runs through that account; a plan that does not qualify is refused.'
    ),
  emails: z
    .array(z.string().max(320))
    .min(1)
    .max(MAX_ADDRESSES)
    .describe(
      `Addresses to check, 1 to ${MAX_ADDRESSES} per call. Duplicates are checked once. Each address gets a confidence verdict from SES Email Address Insights.`
    ),
};

const ValidateContactEmailsOutputSchema = {
  results: z
    .array(
      z.object({
        id: z.string().describe('The address, as the API keyed its verdict. Same value as email.'),
        email: z.string(),
        verdict: z
          .enum(VERDICTS)
          .describe(
            'SES confidence verdict. LOW is low confidence (the contact import drops LOW addresses when sesValidation is on); HIGH and MEDIUM are higher confidence; UNKNOWN means SES could not tell.'
          ),
      })
    )
    .describe('One entry per syntactically valid address that SES checked.'),
  invalid: z
    .array(z.string())
    .describe('Addresses that failed the syntax check. They were not sent to SES.'),
  validatedCount: z.number().describe('How many addresses SES checked.'),
  stoppedEarly: z
    .boolean()
    .describe(
      'True when SES throttled the run. Results then cover only the addresses checked; the rest have no verdict. Retry them later.'
    ),
};

interface ValidateApiResponse {
  verdicts: Record<string, (typeof VERDICTS)[number]>;
  validatedCount: number;
  stoppedEarly: boolean;
  invalid: string[];
}

export function registerValidateContactEmails(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'validate_contact_emails',
    {
      description:
        'Check up to 100 email addresses with SES Email Address Insights and return a deliverability verdict (HIGH, MEDIUM, LOW, or UNKNOWN) for each. Use it before importing or sending to a list you did not collect yourself. It reads only the AWS account row you name and writes nothing: it does not change any contact. Pagination does not apply: there are no pages. To check more than 100 addresses, split the list into batches of at most 100 and call once per batch. Truncation: stoppedEarly is true when SES throttled the run, and then results cover only the addresses checked, so the rest have no verdict and must not be read as LOW. invalid lists addresses that failed the syntax check. A 403 means the caller lacks the contacts import permission.',
      inputSchema: ValidateContactEmailsInputSchema,
      outputSchema: ValidateContactEmailsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const res = await apiRequest<ValidateApiResponse>(resolved.api, {
        method: 'POST',
        path: '/v1/contacts/validate',
        body: { awsAccountId: input.awsAccountId, emails: input.emails },
      });
      if (!res.ok) {
        return res.error;
      }

      const results = Object.entries(res.data.verdicts).map(([address, verdict]) => ({
        id: address,
        email: address,
        verdict,
      }));
      const lines = results.map((r) => `- ${r.email}: ${r.verdict}`);
      const invalidNote =
        res.data.invalid.length > 0
          ? `\n${res.data.invalid.length} address(es) failed the syntax check and were not sent to SES: ${res.data.invalid.join(', ')}.`
          : '';
      const stopNote = res.data.stoppedEarly
        ? '\nSES throttled this run: only the addresses listed have a verdict. Retry the rest later.'
        : '';

      return textResult(
        `Checked ${res.data.validatedCount} address(es) with SES.\n${lines.join('\n')}${invalidNote}${stopNote}`,
        {
          results,
          invalid: res.data.invalid,
          validatedCount: res.data.validatedCount,
          stoppedEarly: res.data.stoppedEarly,
        }
      );
    }
  );
}
