import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { onTestFinished, vi } from 'vitest';
import type { MCPConfig } from '../../config.ts';
import type { WrapsApiProblem, WrapsApiTarget } from '../../wraps-auth.ts';

/**
 * Test helpers for API-backed tools. No test here reaches a real server: `fetch` is replaced
 * for the duration of the test, and every request must match a route.
 */

export interface MockRoute {
  /** HTTP method, upper case. */
  method: string;
  /** URL pathname exactly as sent, so ids stay percent-encoded (`seg()` output). */
  path: string;
  /** Subset match: every key given must equal the request's query value. Extra query keys are allowed. */
  query?: Record<string, string>;
  /** Defaults to 200. */
  status?: number;
  /** JSON body. `undefined` or `null` sends an empty body. */
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Matching rule: a route entry answers one request, and the first unused entry that matches
   * wins. A repeated request needs a second entry, or `repeat: true` to reuse this one.
   */
  repeat?: boolean;
}

export interface MockCall {
  method: string;
  /** Pathname as sent, percent-encoded. */
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Parsed JSON body, or `undefined` when none was sent. */
  body: unknown;
  url: string;
  /** The signal passed to `fetch`. Present for every apiRequest call. */
  signal: AbortSignal | undefined;
}

export interface MockApi {
  /** Every request the code under test made, in order. */
  calls: MockCall[];
  /** Requests that matched no route. Any entry fails the test automatically. */
  unmatched: MockCall[];
  /** Throws when `unmatched` is not empty. Runs automatically when the test ends. */
  verify(): void;
  /** Restores the real `fetch`. Runs automatically when the test ends. */
  restore(): void;
}

function describeCall(call: MockCall): string {
  return `${call.method} ${call.url}`;
}

function matches(route: MockRoute, call: MockCall): boolean {
  if (route.method !== call.method || route.path !== call.path) {
    return false;
  }
  for (const [key, value] of Object.entries(route.query ?? {})) {
    if (call.query[key] !== value) {
      return false;
    }
  }
  return true;
}

function readBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') {
    return undefined;
  }
  try {
    return JSON.parse(init.body);
  } catch {
    return init.body;
  }
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries());
}

/**
 * Stub the global `fetch` with the given routes. A request that matches no route is recorded
 * in `unmatched` and fails the test. The failure is not only a thrown error, because
 * `apiRequest` turns thrown errors into tool results, and a test asserting `isError` would
 * pass on a wrong path.
 */
export function mockApi(routes: MockRoute[]): MockApi {
  const used = new Set<number>();
  const calls: MockCall[] = [];
  const unmatched: MockCall[] = [];

  const stub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const call: MockCall = {
      method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: headersOf(init),
      body: readBody(init),
      url: url.toString(),
      signal: init?.signal ?? undefined,
    };
    calls.push(call);

    const index = routes.findIndex(
      (route, i) => (route.repeat || !used.has(i)) && matches(route, call)
    );
    if (index === -1) {
      unmatched.push(call);
      throw new Error(`mockApi: unexpected request ${describeCall(call)}`);
    }
    const route = routes[index];
    if (!route.repeat) {
      used.add(index);
    }

    const status = route.status ?? 200;
    const nullBody =
      status === 204 || status === 304 || route.body === undefined || route.body === null;
    return new Response(nullBody ? null : JSON.stringify(route.body), {
      status,
      headers: { 'content-type': 'application/json', ...route.headers },
    });
  });

  vi.stubGlobal('fetch', stub);

  const api: MockApi = {
    calls,
    unmatched,
    verify() {
      if (unmatched.length > 0) {
        throw new Error(
          `mockApi: ${unmatched.length} unexpected Wraps API request(s): ${unmatched.map(describeCall).join('; ')}`
        );
      }
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };

  // Inside a test, verify and restore run when it ends. Outside one (e.g. a shared
  // beforeAll), `onTestFinished` throws. Callers then use `verify()` themselves.
  try {
    onTestFinished(() => {
      api.restore();
      api.verify();
    });
  } catch {
    // Not inside a test body; the caller is responsible for verify() and restore().
  }

  return api;
}

export type ApiConfigOverrides = Partial<MCPConfig> & {
  /** Pass `null` to build a config with no API credential at all. */
  api?: WrapsApiTarget | WrapsApiProblem | null;
};

/**
 * Build an `MCPConfig` with an API credential set, without reading the environment or the
 * filesystem. `writeEnabled` is a plain field, so tests toggle it per case. `aws` rejects,
 * because API-backed tools must not touch AWS.
 */
export function makeApiConfig(overrides: ApiConfigOverrides = {}): MCPConfig {
  const { api, ...rest } = overrides;
  const config: MCPConfig = {
    aws: () => Promise.reject(new Error('AWS is not used by API-backed tools (test config)')),
    historyTableName: 'wraps-email-history',
    writeEnabled: false,
    fromEmail: undefined,
    configurationSetName: undefined,
    allowedRecipients: [],
    allowedRecipientDomains: [],
    maxRecipients: 50,
    allowFromOverride: false,
    agentId: undefined,
    enforcerFunction: undefined,
    enforcedMode: false,
    api: {
      token: 'test-token-not-real',
      tokenType: 'api-key',
      apiBase: 'https://api.wraps.test',
      source: 'env',
    },
    ...rest,
  };
  if (api === null) {
    delete config.api;
  } else if (api !== undefined) {
    config.api = api;
  }
  return config;
}

/**
 * Connect an MCP `Client` to a fresh `McpServer` that has only the tool registered by
 * `register`, over an in-memory transport. Close it with `client.close()` at the end of the test.
 */
export async function connectTool(
  register: (server: McpServer, config: MCPConfig) => void,
  config: MCPConfig
): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  register(server, config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}
