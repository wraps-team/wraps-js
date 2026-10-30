import { z } from 'zod';
import type { MCPConfig, ToolError } from './config.ts';

/**
 * Gates for mutating tools. The classes match the MCP contract in graph.md:
 *
 * - W (mutating, reversible): `requireWrite(config)`.
 * - X (destructive or irreversible): `requireWrite(config)`, then `requireConfirm(input)`.
 *   Its input schema also declares `confirm: confirmSchema`.
 *
 * A refusal is an `isError` result that names the fix. No request is sent.
 */

const WRITE_DISABLED = `Write tools are disabled. Set WRAPS_WRITE_ENABLED=true in the "env" block of the wraps entry in your MCP config file, then restart the MCP server. Nothing was changed.`;

const CONFIRM_REQUIRED = `This action is irreversible, so it needs confirm: true. Confirm with the user that they want this, then call the tool again with confirm: true. Nothing was changed.`;

/**
 * The `confirm` field for X tools. A missing or false value is refused by the SDK's schema
 * validation before the handler runs, so the refusal text must name the fix here.
 * A tool may override the description with its own `.describe()`.
 */
export const confirmSchema = z
  .literal(true, {
    error: () =>
      'confirm must be true: this action is irreversible. Re-run with confirm: true after checking the target.',
  })
  .describe(
    'Must be true. Requires confirm: true. This action cannot be undone, so only set it after the user has agreed to it.'
  );

/** Undefined when writes are enabled, otherwise the refusal to return verbatim. */
export function requireWrite(config: MCPConfig): ToolError | undefined {
  if (config.writeEnabled) {
    return undefined;
  }
  return { isError: true, content: [{ type: 'text', text: WRITE_DISABLED }] };
}

/** Undefined when `confirm` is exactly `true`, otherwise the refusal to return verbatim. */
export function requireConfirm(input: { confirm?: unknown }): ToolError | undefined {
  if (input.confirm === true) {
    return undefined;
  }
  return { isError: true, content: [{ type: 'text', text: CONFIRM_REQUIRED }] };
}
