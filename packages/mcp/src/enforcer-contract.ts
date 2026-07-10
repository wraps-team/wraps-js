/**
 * Agent enforcer contract — COPIED VERBATIM.
 *
 * SOURCE OF TRUTH: packages/core/src/agent-enforcer-contract.ts in the `wraps`
 * repo. These types cannot be imported across repos, so they are duplicated
 * here. Any change to the source of truth requires a matching change here.
 *
 * Only the type shapes consumed by the MCP tools are copied (the DynamoDB key
 * builders live server-side and are not needed here).
 */

/** What the caller wants the enforcer to do. */
export type EnforcerAction = 'send' | 'execute' | 'status';

/** The email an agent wants to send. Mirrors the Simple-content SES fields. */
export type AgentEmailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Invocation payload for the enforcer Lambda (RequestResponse).
 * - `send`: an agent asks to send `payload`.
 * - `execute`: the API replays an approved send by `approvalId` (+ `payload`).
 * - `status`: an agent polls the outcome of `approvalId`.
 */
export type EnforcerRequest = {
  action: EnforcerAction;
  agentId: string;
  payload?: AgentEmailPayload;
  approvalId?: string;
};

/** Terminal disposition of an enforcer invocation. */
export type EnforcerStatus = 'sent' | 'pending_approval' | 'blocked' | 'failed' | 'unknown';

/**
 * Enforcer verdict. Policy outcomes (`pending_approval`, `blocked`) are
 * successful responses — the caller reads the disposition, they are never
 * transport errors.
 */
export type EnforcerResponse = {
  status: EnforcerStatus;
  messageId?: string;
  approvalId?: string;
  reason?: string;
};
