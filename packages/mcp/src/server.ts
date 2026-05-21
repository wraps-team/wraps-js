import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MCPConfig } from './config.ts';
import { registerAllTools } from './tools/index.ts';

function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function createServer(config: MCPConfig): McpServer {
  const server = new McpServer({
    name: '@wraps.dev/mcp',
    version: getVersion(),
  });
  registerAllTools(server, config);
  return server;
}
