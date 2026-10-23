import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * True when the connected client can render a form elicitation. The SDK
 * normalises an empty `elicitation: {}` capability to `{ form: {} }`, and
 * `elicitInput` refuses form requests unless `form` is present, so check that.
 */
export function canElicit(server: McpServer): boolean {
  return Boolean(server.server.getClientCapabilities()?.elicitation?.form);
}

/**
 * Ask the user for the sender address. Returns the address only on an explicit
 * accept with a well-formed email. Decline, cancel, a malformed value, or any
 * thrown error all return undefined, so the caller falls back to its original error.
 */
export async function askForFrom(server: McpServer): Promise<string | undefined> {
  try {
    const result = await server.server.elicitInput({
      mode: 'form',
      message:
        'send_email needs a sender address, and WRAPS_FROM_EMAIL is not set. Enter the verified SES address to send from.',
      requestedSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            format: 'email',
            title: 'From address',
            description: 'A verified SES identity (address or domain) in this account and region.',
          },
        },
        required: ['from'],
      },
    });
    if (result.action !== 'accept') {
      return undefined;
    }
    const parsed = z.string().email().safeParse(result.content?.from);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ask whether to re-send to the AWS mailbox simulator after the sandbox rejected
 * the recipient. Only an explicit accept with `confirm: true` returns true.
 */
export async function confirmSimulatorRetry(
  server: McpServer,
  simulatorAddress: string
): Promise<boolean> {
  try {
    const result = await server.server.elicitInput({
      mode: 'form',
      message: `This account is in the SES sandbox, so it can only send to verified recipients. Send to the AWS mailbox simulator ${simulatorAddress} instead to verify sending works?`,
      requestedSchema: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            title: 'Send to the simulator',
            description: `Deliver this message to ${simulatorAddress} instead of the original recipient.`,
          },
        },
        required: ['confirm'],
      },
    });
    return result.action === 'accept' && result.content?.confirm === true;
  } catch {
    return false;
  }
}
