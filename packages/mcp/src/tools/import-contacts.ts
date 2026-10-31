import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, errorResult, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi, type ToolError } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

const MAX_CONTACTS = 10_000;
const MAX_PRINTED_ERRORS = 20;

const ImportRowSchema = z.object({
  email: z.string().max(320).optional().describe('Email address of the contact.'),
  phone: z
    .string()
    .max(32)
    .optional()
    .describe('Phone number of the contact, in E.164 form (for example +14155550123).'),
  firstName: z.string().max(255).optional().describe('First name.'),
  lastName: z.string().max(255).optional().describe('Last name.'),
  company: z.string().max(255).optional().describe('Company name.'),
  jobTitle: z.string().max(255).optional().describe('Job title.'),
  createdAt: z
    .string()
    .optional()
    .describe('When the row was originally created, as any date string. Optional.'),
  smsStatus: z
    .string()
    .optional()
    .describe('SMS consent status: pending_consent, opted_in, opted_out or invalid.'),
  smsConsentedAt: z
    .string()
    .optional()
    .describe('When SMS consent was given, as a date string. Only used with smsStatus opted_in.'),
  properties: z
    .record(z.string(), z.string())
    .optional()
    .describe('Custom properties as string values, keyed by property name.'),
});

const ImportContactsInputSchema = {
  contacts: z
    .array(ImportRowSchema)
    .min(1)
    .max(MAX_CONTACTS)
    .describe(
      `Rows to import, 1 to ${MAX_CONTACTS} per call. A row matches an existing contact by email or phone.`
    ),
  topicIds: z
    .array(z.string().max(36))
    .optional()
    .describe('Ids of topics to attach to the imported contacts. Ids come from list_topics.'),
  duplicateStrategy: z
    .enum(['skip', 'update'])
    .optional()
    .describe(
      'What to do when a row matches an existing contact. "skip" (the default) leaves the existing contact unchanged and counts the row in skipped. "update" changes the existing contact: it fills its blank fields, merges the given properties into its own, and only fills in SMS consent, never overwriting it. "update" requires confirm: true.'
    ),
  sesValidation: z
    .object({
      awsAccountId: z
        .string()
        .min(1)
        .max(36)
        .describe(
          'The Wraps id of a connected AWS account whose SES plan is PRO or ENTERPRISE (a UUID, the awsAccountId field from the account-health output), NOT the 12-digit AWS account number.'
        ),
    })
    .optional()
    .describe(
      'Optional. Runs SES Email Address Insights on the rows first and drops the addresses SES rates LOW confidence, using this AWS account.'
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'Must be true when duplicateStrategy is "update", because that changes existing contacts. Not needed for "skip" or when duplicateStrategy is omitted.'
    ),
};

const ImportContactsOutputSchema = {
  created: z.number().describe('New contacts created.'),
  updated: z
    .number()
    .describe('Existing contacts changed. Always 0 unless duplicateStrategy is "update".'),
  skipped: z.number().describe('Rows that matched an existing contact and were left unchanged.'),
  invalid: z.number().describe('Rows that could not be imported. Each is listed in errors.'),
  errors: z
    .array(
      z.object({
        row: z.number().describe('The row that failed, numbered as the rows were sent.'),
        error: z.string().describe('Why the row failed.'),
      })
    )
    .describe('Every row that failed, with its reason. The text output prints only the first 20.'),
};

interface ImportApiResponse {
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  errors: { row: number; error: string }[];
  duplicates: unknown[];
}

const CONFIRM_UPDATE_REQUIRED: ToolError = errorResult(
  'duplicateStrategy "update" changes existing contacts: it fills their blank fields and merges properties into them. That needs confirm: true. Check with the user that existing contacts should change, then call again with confirm: true. Nothing was imported.'
);

/**
 * Import up to 10,000 contacts in one synchronous call. Writes. Calls `POST /v1/contacts/import`.
 * `confirm` is required only for `duplicateStrategy: "update"`, which changes existing contacts.
 */
export function registerImportContacts(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'import_contacts',
    {
      description:
        'Import up to 10,000 contacts into your Wraps organization in one call, and get back how many were created, updated, skipped and rejected, with the reason for each rejected row. Use it for a list the user has the right to add to Wraps. Each row matches an existing contact by email or phone. The default duplicateStrategy "skip" leaves matching contacts unchanged. duplicateStrategy "update" changes matching contacts (it fills blank fields and merges properties) and requires confirm: true; say so to the user before using it. Pagination: none; split a longer list into calls of at most 10,000 rows. Truncation: nothing is cut. Errors are capped in the text output at the first 20 rows, with a count of the rest; structuredContent.errors lists all of them. Requires WRAPS_WRITE_ENABLED=true. Requires the contacts import permission (contacts:write for API keys). A 402 means the plan\'s contact limit is reached, and nothing was imported.',
      inputSchema: ImportContactsInputSchema,
      outputSchema: ImportContactsOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const writeRefusal = requireWrite(config);
      if (writeRefusal) {
        return writeRefusal;
      }
      if (input.duplicateStrategy === 'update' && input.confirm !== true) {
        return CONFIRM_UPDATE_REQUIRED;
      }
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }

      const duplicateStrategy = input.duplicateStrategy ?? 'skip';
      const result = await apiRequest<ImportApiResponse>(credential.api, {
        method: 'POST',
        path: '/v1/contacts/import',
        body: {
          contacts: input.contacts,
          topicIds: input.topicIds,
          duplicateStrategy,
          sesValidation: input.sesValidation,
        },
      });
      if (!result.ok) {
        return result.error;
      }

      const { created, updated, skipped, invalid, errors } = result.data;
      const printed = errors.slice(0, MAX_PRINTED_ERRORS);
      const more = errors.length - printed.length;
      const summary = `Imported ${input.contacts.length} row(s) with duplicateStrategy "${duplicateStrategy}": ${created} created, ${updated} updated, ${skipped} skipped, ${invalid} invalid.`;
      const errorLines =
        errors.length === 0
          ? ''
          : `\n\nRow errors (first ${printed.length} of ${errors.length}):\n${printed
              .map((e) => `- row ${e.row}: ${e.error}`)
              .join('\n')}${
              more > 0
                ? `\n...and ${more} more. structuredContent.errors lists every failed row.`
                : ''
            }`;

      return textResult(`${summary}${errorLines}`, {
        created,
        updated,
        skipped,
        invalid,
        errors,
      });
    }
  );
}
