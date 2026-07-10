import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { MCPConfig } from './config.ts';
import type { EnforcerRequest, EnforcerResponse } from './enforcer-contract.ts';

/**
 * Thrown when the enforcer Lambda was reached but faulted (a Lambda
 * `FunctionError`). Distinct from a transport failure (a rejected
 * `InvokeCommand`), which surfaces as a plain {@link Error}.
 */
export class EnforcerFunctionError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'EnforcerFunctionError';
  }
}

/**
 * Invoke the customer-side agent enforcer Lambda (RequestResponse) and decode
 * its {@link EnforcerResponse}. The Lambda is authoritative for all policy
 * decisions — this helper only transports the request and parses the verdict.
 *
 * @param region - AWS region hosting the enforcer Lambda.
 * @param functionName - Qualified per-agent alias ARN of the enforcer Lambda.
 * @param request - The {@link EnforcerRequest} to send.
 * @returns The decoded {@link EnforcerResponse} verdict.
 * @throws {EnforcerFunctionError} When the Lambda faults (`FunctionError`).
 * @throws {Error} On transport failure or an unparseable/empty payload — with
 *   {@link EnforcerFunctionError}, the only conditions the caller surfaces as
 *   `isError`. Policy outcomes (`pending_approval`/`blocked`) are successful
 *   responses.
 *
 * @example
 * ```typescript
 * const verdict = await invokeEnforcer('us-east-1', config.enforcerFunction, {
 *   action: 'send',
 *   agentId: 'agent-123',
 *   payload: { from, to, subject, html, text },
 * });
 * ```
 */
export async function invokeEnforcer(
  region: string,
  functionName: string,
  request: EnforcerRequest
): Promise<EnforcerResponse> {
  const client = new LambdaClient({ region });
  try {
    const response = await client.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: new TextEncoder().encode(JSON.stringify(request)),
      })
    );

    if (response.FunctionError) {
      const detail = response.Payload
        ? new TextDecoder().decode(response.Payload)
        : response.FunctionError;
      throw new EnforcerFunctionError(detail);
    }

    if (!response.Payload) {
      throw new Error('Enforcer Lambda returned an empty payload.');
    }

    return JSON.parse(new TextDecoder().decode(response.Payload)) as EnforcerResponse;
  } finally {
    client.destroy();
  }
}

/**
 * Structured outcome of an enforcer invocation for an MCP tool: either the
 * decoded verdict (`ok: true`) or a caller-facing failure message
 * (`ok: false`) that the tool turns into a `textError`.
 */
export type EnforcerToolResult =
  | { ok: true; response: EnforcerResponse }
  | { ok: false; message: string };

/**
 * Invoke the enforcer for an MCP tool, injecting the agent identity and
 * enforcer function from `config` and normalizing failures into a caller-facing
 * message. Consolidates the enforced-mode non-null assertions and the shared
 * failure copy for both `send_email` and `check_send_status`.
 *
 * @param config - The MCP config; enforced mode guarantees `agentId` and
 *   `enforcerFunction` are set.
 * @param request - The enforcer request minus `agentId`, which is supplied here.
 * @returns An {@link EnforcerToolResult} — the verdict on success, or a failure
 *   message distinguishing an enforcer fault from a transport failure.
 *
 * @example
 * ```typescript
 * const result = await invokeEnforcerForTool(config, { action: 'send', payload });
 * if (!result.ok) return textError(result.message);
 * return { structuredContent: result.response };
 * ```
 */
export async function invokeEnforcerForTool(
  config: MCPConfig,
  request: Omit<EnforcerRequest, 'agentId'>
): Promise<EnforcerToolResult> {
  try {
    const response = await invokeEnforcer(
      config.region,
      // biome-ignore lint/style/noNonNullAssertion: enforcedMode guarantees these are set.
      config.enforcerFunction!,
      // biome-ignore lint/style/noNonNullAssertion: enforcedMode guarantees these are set.
      { ...request, agentId: config.agentId! }
    );
    return { ok: true, response };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof EnforcerFunctionError) {
      return { ok: false, message: `Agent enforcer returned an error: ${detail}` };
    }
    return { ok: false, message: `Failed to reach agent enforcer: ${detail}` };
  }
}
