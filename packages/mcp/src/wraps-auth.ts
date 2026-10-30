import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the Wraps control-plane API lives and which credential reaches it.
 *
 * Port of the CLI's plane rules (`packages/cli/src/utils/shared/api-target.ts` and
 * `config.ts`). The CLI and this server read the same `~/.wraps/config.json`, so a
 * user who ran `wraps auth login` or `wraps selfhost login` gets the same plane
 * here. Synchronous and network-free by design: it runs at startup.
 */

export const DEFAULT_API_BASE = 'https://api.wraps.dev';

/** Mirrors the CLI's `SessionAuth`. Only the fields this module reads are typed. */
interface SessionAuth {
  token?: string;
  tokenType?: 'session' | 'api-key';
  expiresAt?: string;
  apiUrl?: string;
}

/** Mirrors the CLI's `AuthConfig`. */
interface AuthConfig {
  auth?: SessionAuth;
  selfhost?: Record<string, SessionAuth>;
  activeInstance?: string;
}

/**
 * - `env`: the credential is `WRAPS_API_KEY`.
 * - `cli-session`: the SaaS session saved by `wraps auth login`.
 * - `cli-selfhost`: the active self-hosted session saved by `wraps selfhost login`.
 *
 * It names where the credential came from. `apiBase` names the plane. The two can differ:
 * `WRAPS_API_KEY` with an active self-hosted pointer is `source: 'env'` on the self-hosted plane.
 */
export type WrapsApiCredentialSource = 'env' | 'cli-session' | 'cli-selfhost';

export interface WrapsApiTarget {
  token: string;
  tokenType: 'api-key' | 'session';
  /** Base URL with no trailing slash. */
  apiBase: string;
  /** From `WRAPS_ORG_ID`. Sent as `x-organization-id` when set. */
  orgId?: string;
  source: WrapsApiCredentialSource;
}

/**
 * A stored credential that cannot be used as-is. The message says what to do. It never
 * contains the token.
 */
export interface WrapsApiProblem {
  problem: string;
}

/** `undefined` means no credential, a usable target, or a problem to report. */
export type ResolvedWrapsApi = WrapsApiTarget | WrapsApiProblem | undefined;

export function isWrapsApiProblem(value: unknown): value is WrapsApiProblem {
  return isRecord(value) && typeof value.problem === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Read `<homeDir>/.wraps/config.json`. Any failure (missing file, bad JSON, wrong shape)
 * means "no stored config". A corrupt file must not stop the server from starting.
 */
function readAuthConfig(homeDir: string): AuthConfig | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(homeDir, '.wraps', 'config.json'), 'utf-8')
    );
    return isRecord(parsed) ? (parsed as AuthConfig) : null;
  } catch {
    return null;
  }
}

function unexpiredToken(session: SessionAuth | undefined): string | undefined {
  if (!session || typeof session.token !== 'string' || session.token === '') {
    return undefined;
  }
  if (session.expiresAt && new Date(session.expiresAt) <= new Date()) {
    return undefined;
  }
  return session.token;
}

/**
 * Which self-hosted instance (if any) the machine points at. Same rules as the CLI.
 * The stored pointer is authoritative, and a stale pointer falls back to SaaS. Without a
 * pointer, a lone self-hosted session is adopted only when no SaaS token is stored at all
 * (even an expired one). Anything ambiguous stays on SaaS.
 */
function pickInstance(config: AuthConfig | null): [string, SessionAuth] | undefined {
  const instances = config?.selfhost;
  if (!isRecord(instances)) {
    return undefined;
  }

  const active = config?.activeInstance;
  if (active) {
    // Own keys only, and without Object.hasOwn: the package lib is ES2020.
    return Object.keys(instances).includes(active)
      ? [active, instances[active] as SessionAuth]
      : undefined;
  }

  const keys = Object.keys(instances);
  if (config?.auth?.token || keys.length !== 1) {
    return undefined;
  }
  return [keys[0], instances[keys[0]] as SessionAuth];
}

/**
 * Resolve the Wraps API target from the environment and the CLI's stored session.
 *
 * - `WRAPS_API_KEY` wins as the credential. It is used on whichever plane is active.
 * - `WRAPS_API_URL` overrides the base URL and disables the self-hosted pointer.
 * - Otherwise the active plane is the self-hosted pointer, or SaaS.
 * - An expired session, or no session and no key, is `undefined`.
 * - A self-hosted session with no stored `apiUrl` is `{ problem }`. The MCP does not scan AWS
 *   for the URL. The user reruns `wraps selfhost login`.
 * - `homeDir` is the user's home directory. The config lives at `<homeDir>/.wraps/config.json`.
 *   The CLI's `getWrapsDir` has no env override, so none is read here either.
 */
export function resolveWrapsApi(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string
): ResolvedWrapsApi {
  const config = readAuthConfig(homeDir);
  const urlOverride = nonEmpty(env.WRAPS_API_URL);
  const instance = urlOverride ? undefined : pickInstance(config);
  const session = instance ? instance[1] : config?.auth;

  const explicitKey = nonEmpty(env.WRAPS_API_KEY);
  const token = explicitKey ?? unexpiredToken(session);
  if (!token) {
    return undefined;
  }

  const orgId = nonEmpty(env.WRAPS_ORG_ID);
  const tokenType: WrapsApiTarget['tokenType'] = explicitKey
    ? 'api-key'
    : session?.tokenType === 'api-key'
      ? 'api-key'
      : 'session';
  const source: WrapsApiCredentialSource = explicitKey
    ? 'env'
    : instance
      ? 'cli-selfhost'
      : 'cli-session';

  let apiBase = DEFAULT_API_BASE;
  if (urlOverride) {
    apiBase = stripTrailingSlashes(urlOverride);
  } else if (instance) {
    const instanceKey = instance[0];
    const apiUrl = nonEmpty(session?.apiUrl);
    if (!apiUrl) {
      return {
        problem: `The self-hosted Wraps instance at ${instanceKey} has no API URL saved for this session, so the MCP server cannot tell where to send requests. Rerun \`wraps selfhost login\` for that instance, then restart the MCP server.`,
      };
    }
    apiBase = stripTrailingSlashes(apiUrl);
  }

  return {
    token,
    tokenType,
    apiBase,
    source,
    ...(orgId ? { orgId } : {}),
  };
}
