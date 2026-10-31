import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';

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

const GetBrandKitInput = {
  id: z.string().max(36).describe('The brand kit id, from list_brand_kits.'),
};

/**
 * Read one brand kit by id. Read-only. Calls `GET /v1/brand-kits/:id`, which returns a single
 * record and is not paginated.
 */
export function registerGetBrandKit(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_brand_kit',
    {
      description:
        'Get one brand kit by id: logo, colors, fonts, button style, company details, social links, and isDefault. Use it after list_brand_kits has given you the id, or to read a kit before update_brand_kit or set_default_brand_kit. Returns a single record: pagination does not apply, and nothing is truncated (hasMore is never set). A 404 means no brand kit with that id exists in this organization.',
      inputSchema: GetBrandKitInput,
      outputSchema: BrandKitRecord,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }
      const result = await apiRequest<z.infer<typeof BrandKitRecord>>(credential.api, {
        method: 'GET',
        path: `/v1/brand-kits/${seg(input.id)}`,
      });
      if (!result.ok) {
        return result.error;
      }
      const kit = result.data;
      return textResult(
        `Brand kit "${kit.name}" (${kit.id})${kit.isDefault ? ', the default kit' : ''}.`,
        kit
      );
    }
  );
}
