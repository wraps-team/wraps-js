import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';
import { connectTool, makeApiConfig } from './helpers/mock-api.ts';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('requireWrite()', () => {
  it('returns undefined when WRAPS_WRITE_ENABLED is on', () => {
    expect(requireWrite(makeApiConfig({ writeEnabled: true }))).toBeUndefined();
  });

  it('refuses with a fix that names WRAPS_WRITE_ENABLED when writes are off', () => {
    const refusal = requireWrite(makeApiConfig({ writeEnabled: false }));
    expect(refusal?.isError).toBe(true);
    expect(text(refusal ?? {})).toContain('WRAPS_WRITE_ENABLED=true');
    expect(text(refusal ?? {})).toMatch(/restart/);
  });
});

describe('requireConfirm()', () => {
  it('passes only when confirm is exactly true', () => {
    expect(requireConfirm({ confirm: true })).toBeUndefined();
  });

  it.each([
    ['missing', {}],
    ['false', { confirm: false }],
    ['the string "true"', { confirm: 'true' }],
    ['1', { confirm: 1 }],
  ])('refuses when confirm is %s', (_label, input) => {
    const refusal = requireConfirm(input);
    expect(refusal?.isError).toBe(true);
    expect(text(refusal ?? {})).toContain('confirm: true');
  });
});

describe('confirmSchema', () => {
  it('accepts only the literal true', () => {
    expect(confirmSchema.safeParse(true).success).toBe(true);
    expect(confirmSchema.safeParse(false).success).toBe(false);
    expect(confirmSchema.safeParse(undefined).success).toBe(false);
    expect(confirmSchema.safeParse('true').success).toBe(false);
  });
});

describe('X tool with confirm: confirmSchema, through the MCP SDK', () => {
  // Observed behaviour, pinned here so C-node X tests assert the real outcome. The MCP SDK
  // validates `inputSchema` before the handler runs, so a missing `confirm` should never reach it.
  it('does not run the handler when confirm is missing, and reports the failure to the client', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'deleted' }] }));
    const register = (server: McpServer) => {
      server.registerTool(
        'dummy_destroy',
        {
          description: 'Test-only destructive tool. Requires confirm: true.',
          inputSchema: { id: z.string(), confirm: confirmSchema },
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
        handler
      );
    };
    const config: MCPConfig = makeApiConfig({ writeEnabled: true });
    const client = await connectTool(register, config);

    let outcome:
      | { kind: 'result'; isError: boolean; text: string }
      | { kind: 'thrown'; message: string };
    try {
      const result = await client.callTool({ name: 'dummy_destroy', arguments: { id: 'x' } });
      outcome = { kind: 'result', isError: result.isError === true, text: text(result) };
    } catch (err) {
      outcome = { kind: 'thrown', message: err instanceof Error ? err.message : String(err) };
    }

    // The SDK refuses at schema validation, before the handler. The refusal text is the custom
    // message set on confirmSchema, so it names the fix.
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('confirm must be true');
    expect(outcome.text).toContain('Re-run with confirm: true');
    expect(handler).not.toHaveBeenCalled();
    await client.close();
  });

  it('runs the handler when confirm is true', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'deleted' }] }));
    const register = (server: McpServer) => {
      server.registerTool(
        'dummy_destroy',
        {
          description: 'Test-only destructive tool. Requires confirm: true.',
          inputSchema: { id: z.string(), confirm: confirmSchema },
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
        handler
      );
    };
    const client = await connectTool(register, makeApiConfig({ writeEnabled: true }));
    const result = await client.callTool({
      name: 'dummy_destroy',
      arguments: { id: 'x', confirm: true },
    });
    expect(result.isError).not.toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    await client.close();
  });
});
