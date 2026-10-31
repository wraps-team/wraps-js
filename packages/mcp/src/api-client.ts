import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolError } from './config.ts';
import type { WrapsApiTarget } from './wraps-auth.ts';

/**
 * The only way a tool calls the Wraps API. Tool files never call `fetch` directly.
 *
 * It adds the Bearer token and `x-organization-id`, a 30 second timeout, JSON parsing, and
 * the API's `{ error, code, requestId? }` contract. Every failure becomes a tool error whose
 * text says what to do next, and that text never contains the token.
 */

export const API_TIMEOUT_MS = 30_000;

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** `undefined` and `null` are omitted from the query string. Numbers and booleans are stringified. */
export type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequest {
  method: ApiMethod;
  /** Starts with `/`. Ids placed in the path must be wrapped in `seg()`. */
  path: string;
  query?: Record<string, QueryValue>;
  /** JSON-serialized when present. `undefined` sends no body. */
  body?: unknown;
  /**
   * Set to `false` for a public route. Then no `Authorization` and no `x-organization-id` header
   * is sent, so the request carries nothing that identifies the caller. Omit it for every
   * authenticated route.
   */
  auth?: false;
}

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; error: ToolError };

/** Encode a record id for a URL path segment. Pass every id through this. */
export function seg(id: string): string {
  return encodeURIComponent(id);
}

/** A successful tool result carrying `structuredContent` and a short human text. */
export function textResult<T extends Record<string, unknown>>(text: string, structuredContent: T) {
  return { content: [{ type: 'text' as const, text }], structuredContent };
}

/** A tool error. The text names the fix. */
export function errorResult(text: string): ToolError {
  return { isError: true, content: [{ type: 'text', text }] };
}

let cachedVersion: string | undefined;

/** The version in `packages/mcp/package.json`, read the same way `server.ts` does. */
function packageVersion(): string {
  if (cachedVersion === undefined) {
    try {
      const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
      cachedVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    } catch {
      cachedVersion = '0.0.0';
    }
  }
  return cachedVersion;
}

const NOT_JSON = Symbol('not-json');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildUrl(api: WrapsApiTarget, req: ApiRequest): string {
  const path = req.path.startsWith('/') ? req.path : `/${req.path}`;
  const url = new URL(`${api.apiBase}${path}`);
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function timeoutFailure(req: ApiRequest): ApiResult<never> {
  return {
    ok: false,
    error: errorResult(
      `The Wraps API did not answer ${req.method} ${req.path} within ${API_TIMEOUT_MS / 1000} seconds. Retry in a moment; if it keeps happening, the API may be degraded.`
    ),
  };
}

function networkFailure(api: WrapsApiTarget, req: ApiRequest): ApiResult<never> {
  return {
    ok: false,
    error: errorResult(
      `Could not reach the Wraps API at ${api.apiBase} for ${req.method} ${req.path}. Check the network connection and WRAPS_API_URL, then retry.`
    ),
  };
}

function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Turn a non-2xx response into an actionable message. The API's `code` is always included,
 * and so is its `error` message, verbatim where the fix depends on it.
 */
function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function describeFailure(
  api: WrapsApiTarget,
  status: number,
  parsed: unknown,
  headerRequestId: string | null
): string {
  const body = isRecord(parsed) ? parsed : {};
  // `error` is the contract's field. Some routes answer with `message` instead, so fall back to it.
  const message = nonEmptyText(body.error) ?? nonEmptyText(body.message);
  const code = typeof body.code === 'string' && body.code !== '' ? body.code : undefined;
  const requestId =
    typeof body.requestId === 'string' && body.requestId !== ''
      ? body.requestId
      : (headerRequestId ?? undefined);

  const tag = code ? ` (code: ${code})` : '';
  const messagePart = message ? `: ${message}` : '';

  if (status === 401) {
    if (api.source === 'env') {
      return `Wraps rejected the API key in WRAPS_API_KEY${tag}. Check that WRAPS_API_KEY is current (it may be revoked or from another environment), then restart the MCP server.`;
    }
    const login = api.source === 'cli-selfhost' ? 'wraps selfhost login' : 'wraps auth login';
    return `Your Wraps session is missing, expired, or was revoked${tag}. Run \`${login}\`, then restart the MCP server.`;
  }
  if (status === 403) {
    return `Permission denied${tag}${messagePart}. Your role (for a wraps auth login session), your API key's scopes (for WRAPS_API_KEY) or your plan does not allow this action. Ask an organization admin to check your role or to create a key with the scope this action needs, or check your plan.`;
  }
  if (status === 404) {
    return `Not found in this organization${tag}${messagePart}. Check the id with the matching list tool. The record may belong to another organization or may have been deleted.`;
  }
  if (status === 400 || status === 422) {
    return `The Wraps API rejected the request${tag}: ${message ?? 'invalid input'}. Fix the arguments and retry.`;
  }
  if (status === 409) {
    return `Conflict${tag}${messagePart}. Read it again, then retry, or resolve the conflict the API describes.`;
  }
  if (status === 429) {
    // The API text is appended, not substituted: an allowance limit (e.g. event_limit_exceeded)
    // needs a different fix than a burst limit, and the code tells the agent which one it is.
    return `Rate limited by the Wraps API${tag}: retry later.${message ? ` API message: ${message}.` : ''}`;
  }
  if (status >= 500) {
    const reference = requestId ? ` Request id ${requestId}; include it when reporting this.` : '';
    return `Wraps API error (HTTP ${status})${tag}${messagePart}.${reference} Retry later.`;
  }
  return `Wraps API returned HTTP ${status}${tag}${messagePart}.`;
}

/**
 * Call the Wraps API. Resolves to `{ ok: true, status, data }` on 2xx, or `{ ok: false, error }`
 * with a tool error on anything else, including network failure and timeout. It never throws.
 */
export async function apiRequest<T = unknown>(
  api: WrapsApiTarget,
  req: ApiRequest
): Promise<ApiResult<T>> {
  let url: string;
  try {
    url = buildUrl(api, req);
  } catch {
    return {
      ok: false,
      error: errorResult(
        'The Wraps API base URL is not a valid URL. Check WRAPS_API_URL (or the saved self-hosted API URL), then restart the MCP server.'
      ),
    };
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': `wraps-mcp/${packageVersion()}`,
  };
  if (req.auth !== false) {
    headers.authorization = `Bearer ${api.token}`;
    if (api.orgId) {
      headers['x-organization-id'] = api.orgId;
    }
  }
  let body: string | undefined;
  if (req.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(req.body);
  }

  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (err) {
    return isTimeoutError(err) ? timeoutFailure(req) : networkFailure(api, req);
  }

  let parsed: unknown;
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = NOT_JSON;
    }
  }

  if (response.ok) {
    if (parsed === NOT_JSON) {
      return {
        ok: false,
        error: errorResult(
          `The Wraps API answered ${req.method} ${req.path} with a body that is not JSON (HTTP ${response.status}). Retry later; if it persists, check WRAPS_API_URL.`
        ),
      };
    }
    return { ok: true, status: response.status, data: parsed as T };
  }

  return {
    ok: false,
    error: errorResult(
      describeFailure(
        api,
        response.status,
        parsed === NOT_JSON ? undefined : parsed,
        response.headers.get('x-request-id')
      )
    ),
  };
}
