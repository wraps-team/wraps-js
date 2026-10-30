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

const SetDefaultBrandKitInput = {
  id: z.string().max(36).describe('The brand kit to make the default, from list_brand_kits.'),
};

/**
 * Make one brand kit the organization's only default. Mutating but reversible, so it is a W
 * tool: it needs `WRAPS_WRITE_ENABLED=true`. Calls `POST /v1/brand-kits/:id/default`.
 */
export function registerSetDefaultBrandKit(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'set_default_brand_kit',
    {
      description:
        'Make one brand kit the default for the organization. The previous default is cleared in the same step, so exactly one kit is the default. Use this to change the default; update_brand_kit cannot. Needs WRAPS_WRITE_ENABLED=true. Returns the single record of the kit that is now the default: pagination does not apply, and nothing is truncated (hasMore is never set). A 404 means no brand kit with that id exists in this organization.',
      inputSchema: SetDefaultBrandKitInput,
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
        path: `/v1/brand-kits/${seg(input.id)}/default`,
      });
      if (!result.ok) {
        return result.error;
      }
      const kit = result.data;
      return textResult(`Brand kit "${kit.name}" (${kit.id}) is now the default kit.`, kit);
    }
  );
}
