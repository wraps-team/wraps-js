import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
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

const ListBrandKitsOutput = z.object({
  brandKits: z.array(BrandKitRecord),
  count: z.number().describe('Number of kits returned, which is every kit in the organization.'),
});

/**
 * List every brand kit in the organization. Read-only. Calls `GET /v1/brand-kits`, which is not
 * paginated and returns `{ brandKits, count }`.
 */
export function registerListBrandKits(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_brand_kits',
    {
      description:
        "List the organization's brand kits: name, logo, colors, fonts, button style, company details and social links, with isDefault marking the one default kit. Use this to find a brand kit id for get_brand_kit, update_brand_kit, set_default_brand_kit or delete_brand_kit, or to check whether a kit already exists before create_brand_kit. Pagination: none. The route returns every kit in one response, so there is no cursor, offset or limit to pass. Truncation: nothing is cut and hasMore is never set; count equals the number of kits returned, so a short list is complete. The default kit comes first, then the most recently updated.",
      inputSchema: {},
      outputSchema: ListBrandKitsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }
      const result = await apiRequest<z.infer<typeof ListBrandKitsOutput>>(credential.api, {
        method: 'GET',
        path: '/v1/brand-kits',
      });
      if (!result.ok) {
        return result.error;
      }
      const brandKits = result.data.brandKits ?? [];
      return textResult(
        `Found ${brandKits.length} brand kit${brandKits.length === 1 ? '' : 's'}.`,
        { brandKits, count: brandKits.length }
      );
    }
  );
}
