import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

const BrandKitRecord = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  backgroundColor: z.string(),
  textColor: z.string(),
  fontFamily: z.string(),
  headingFontFamily: z.string().nullable(),
  buttonStyle: z.string().describe('rounded, square or pill.'),
  buttonRadius: z.string(),
  companyName: z.string().nullable(),
  companyAddress: z.string().nullable(),
  socialLinks: z.array(z.object({ platform: z.string(), url: z.string() })),
  sourceDomain: z.string().nullable(),
  autoExtracted: z.boolean(),
  isDefault: z.boolean().describe('True for exactly one kit per organization, when any exist.'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateBrandKitInput = {
  name: z
    .string()
    .optional()
    .describe('Display name. A blank name is stored as "Untitled Brand Kit".'),
  logoUrl: z.string().nullable().optional().describe('Public URL of the logo image.'),
  primaryColor: z.string().optional().describe('Primary brand color, for example #112233.'),
  secondaryColor: z.string().optional().describe('Secondary brand color.'),
  backgroundColor: z.string().optional().describe('Background color.'),
  textColor: z.string().optional().describe('Body text color.'),
  fontFamily: z.string().optional().describe('Body font family, for example Inter.'),
  headingFontFamily: z
    .string()
    .nullable()
    .optional()
    .describe('Heading font family. Null or omitted means the body font is used.'),
  buttonStyle: z.string().optional().describe('Button style: rounded, square or pill.'),
  buttonRadius: z.string().optional().describe('Button corner radius, for example 8px.'),
  companyName: z.string().nullable().optional().describe('Company name shown in emails.'),
  companyAddress: z.string().nullable().optional().describe('Postal address shown in emails.'),
  socialLinks: z
    .array(
      z.object({
        platform: z.string().describe('For example x, linkedin or github.'),
        url: z.string().describe('Profile URL.'),
      })
    )
    .optional()
    .describe('Social profile links. Each entry needs a non-empty platform and url.'),
  sourceDomain: z.string().nullable().optional().describe('Website domain the kit came from.'),
  autoExtracted: z
    .boolean()
    .optional()
    .describe('Set true only if the kit was extracted from a website, not typed by hand.'),
  isDefault: z
    .boolean()
    .optional()
    .describe(
      'Make this kit the default. The first kit in an organization is always the default. Otherwise true clears the previous default.'
    ),
};

/**
 * Create a brand kit. Mutating but reversible, so it is a W tool: it needs
 * `WRAPS_WRITE_ENABLED=true`. Calls `POST /v1/brand-kits` and returns the new record.
 */
export function registerCreateBrandKit(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'create_brand_kit',
    {
      description:
        'Create a brand kit: a name, logo, colors, fonts, button style, company details and social links that email templates can use. Use list_brand_kits first to avoid duplicates. The first kit in the organization becomes the default automatically; later kits become the default only with isDefault: true, which clears the previous default. Needs WRAPS_WRITE_ENABLED=true. Returns the single created record: pagination does not apply, and nothing is truncated (hasMore is never set). A 400 means a field was refused (for example a social link with an empty platform or url); fix the arguments and retry.',
      inputSchema: CreateBrandKitInput,
      outputSchema: BrandKitRecord,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const writeRefusal = requireWrite(config);
      if (writeRefusal) {
        return writeRefusal;
      }
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }
      const result = await apiRequest<z.infer<typeof BrandKitRecord>>(credential.api, {
        method: 'POST',
        path: '/v1/brand-kits',
        body: input,
      });
      if (!result.ok) {
        return result.error;
      }
      const kit = result.data;
      return textResult(
        `Created brand kit "${kit.name}" (${kit.id})${kit.isDefault ? ', now the default kit' : ''}.`,
        kit
      );
    }
  );
}
