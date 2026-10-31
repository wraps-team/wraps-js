import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
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

const UpdateBrandKitInput = {
  id: z.string().max(36).describe('The brand kit id, from list_brand_kits.'),
  name: z
    .string()
    .optional()
    .describe('New display name. A blank name is refused with 400; omit the field to keep it.'),
  logoUrl: z.string().nullable().optional().describe('New logo URL. Pass null to clear it.'),
  primaryColor: z.string().optional().describe('New primary color, for example #112233.'),
  secondaryColor: z.string().optional().describe('New secondary color.'),
  backgroundColor: z.string().optional().describe('New background color.'),
  textColor: z.string().optional().describe('New body text color.'),
  fontFamily: z.string().optional().describe('New body font family.'),
  headingFontFamily: z
    .string()
    .nullable()
    .optional()
    .describe('New heading font family. Pass null to use the body font.'),
  buttonStyle: z.string().optional().describe('New button style: rounded, square or pill.'),
  buttonRadius: z.string().optional().describe('New button corner radius, for example 8px.'),
  companyName: z
    .string()
    .nullable()
    .optional()
    .describe('New company name. Pass null to clear it.'),
  companyAddress: z
    .string()
    .nullable()
    .optional()
    .describe('New postal address. Pass null to clear it.'),
  socialLinks: z
    .array(
      z.object({
        platform: z.string().describe('For example x, linkedin or github.'),
        url: z.string().describe('Profile URL.'),
      })
    )
    .optional()
    .describe(
      'Replaces the whole social links list. Each entry needs a non-empty platform and url.'
    ),
  sourceDomain: z.string().nullable().optional().describe('New source website domain.'),
};

/**
 * Partially update a brand kit. Mutating but reversible, so it is a W tool: it needs
 * `WRAPS_WRITE_ENABLED=true`. Calls `PATCH /v1/brand-kits/:id` with only the fields passed.
 * It cannot change the default; use set_default_brand_kit for that.
 */
export function registerUpdateBrandKit(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'update_brand_kit',
    {
      description:
        'Change one or more fields of a brand kit: name, logo, colors, fonts, button style, company details, social links. Only the fields you pass are changed; read the kit with get_brand_kit first if you need its current values. socialLinks, when passed, replaces the whole list. To change which kit is the default, use set_default_brand_kit instead. Needs WRAPS_WRITE_ENABLED=true. Returns the single updated record: pagination does not apply, and nothing is truncated (hasMore is never set). A 404 means no brand kit with that id exists in this organization; a 400 means a field was refused (for example a blank name).',
      inputSchema: UpdateBrandKitInput,
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
      const { id, ...fields } = input;
      const result = await apiRequest<z.infer<typeof BrandKitRecord>>(credential.api, {
        method: 'PATCH',
        path: `/v1/brand-kits/${seg(id)}`,
        body: fields,
      });
      if (!result.ok) {
        return result.error;
      }
      const kit = result.data;
      return textResult(`Updated brand kit "${kit.name}" (${kit.id}).`, kit);
    }
  );
}
