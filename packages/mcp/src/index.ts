import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.ts';
import { ConfigError } from './errors.ts';
import { createServer } from './server.ts';

async function main(): Promise<void> {
  // Nothing before connect() may touch the network. Configuration is read from
  // the environment synchronously and AWS credentials are resolved on first
  // tool call, so a machine without credentials still gets a server that can
  // list its tools and explain what it needs.
  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  // A config failure happens before the transport is connected, so the client
  // only ever renders "server failed to start". Naming the server and the fix
  // is all we can do from stderr — keep the multi-line guidance intact.
  process.stderr.write(
    err instanceof ConfigError
      ? `wraps-mcp cannot start — configuration incomplete.\n\n${message}\n`
      : `wraps-mcp fatal: ${message}\n`
  );
  process.exit(1);
});
