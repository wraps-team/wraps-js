import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MCPConfig } from '../config.ts';
import { registerCheckSendStatus } from './check-send-status.ts';
import { registerGetEmailEventLog } from './get-email-event-log.ts';
import { registerListRecentSends } from './list-recent-sends.ts';
import { registerListSuppressions } from './list-suppressions.ts';
import { registerSendEmail } from './send-email.ts';
import { registerVerifyDomainStatus } from './verify-domain-status.ts';

export function registerAllTools(server: McpServer, config: MCPConfig): void {
  registerSendEmail(server, config);
  registerListRecentSends(server, config);
  registerGetEmailEventLog(server, config);
  registerVerifyDomainStatus(server, config);
  registerListSuppressions(server, config);
  if (config.enforcedMode) {
    registerCheckSendStatus(server, config);
  }
}
