import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, requireApi } from '../config.ts';
import { makeApiConfig } from './helpers/mock-api.ts';

const FUTURE = '2099-01-01T00:00:00.000Z';

// loadConfig() must stay synchronous and network-free. fetch is replaced and must never be called.
// os.homedir() reads the native environment, so HOME is set by mutation. Replacing process.env
// wholesale would not reach it, and the test would read the developer's real ~/.wraps.
const ENV_KEYS = [
  'HOME',
  'WRAPS_API_KEY',
  'WRAPS_API_URL',
  'WRAPS_ORG_ID',
  'WRAPS_HOME',
  'WRAPS_WRITE_ENABLED',
];
let home: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'wraps-config-api-'));
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HOME = home;
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});

function writeCliSession(): void {
  mkdirSync(join(home, '.wraps'), { recursive: true });
  writeFileSync(
    join(home, '.wraps', 'config.json'),
    JSON.stringify({ auth: { token: 'session-saas', tokenType: 'session', expiresAt: FUTURE } })
  );
}

describe('loadConfig() api field', () => {
  it('sets api from WRAPS_API_KEY and makes no network call', () => {
    process.env.WRAPS_API_KEY = 'wk_live_env';
    const config = loadConfig();
    expect(config.api).toEqual({
      token: 'wk_live_env',
      tokenType: 'api-key',
      apiBase: 'https://api.wraps.dev',
      source: 'env',
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('sets api from an unexpired CLI session in the home directory', () => {
    writeCliSession();
    expect(loadConfig().api).toMatchObject({ token: 'session-saas', source: 'cli-session' });
  });

  it('omits the api key entirely when there is no credential', () => {
    const config = loadConfig();
    expect('api' in config).toBe(false);
    expect(config.api).toBeUndefined();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('carries WRAPS_ORG_ID through as orgId', () => {
    process.env.WRAPS_API_KEY = 'wk_live_env';
    process.env.WRAPS_ORG_ID = 'org_42';
    expect(loadConfig().api).toMatchObject({ orgId: 'org_42' });
  });

  it('keeps the existing fields unchanged', () => {
    process.env.WRAPS_API_KEY = 'wk_live_env';
    process.env.WRAPS_WRITE_ENABLED = 'true';
    const config = loadConfig();
    expect(config.writeEnabled).toBe(true);
    expect(config.historyTableName).toBe('wraps-email-history');
    expect(config.maxRecipients).toBe(50);
    expect(typeof config.aws).toBe('function');
  });
});

describe('requireApi()', () => {
  it('returns the target when a credential is set', () => {
    const config = makeApiConfig();
    const result = requireApi(config);
    expect(result).toEqual({ ok: true, api: config.api });
  });

  it('returns a tool error naming the env key and wraps auth login when no credential is set', () => {
    const config = makeApiConfig({ api: null });
    const result = requireApi(config);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.isError).toBe(true);
    const text = result.error.content[0].text;
    expect(text).toContain('WRAPS_API_KEY');
    expect(text).toContain('`wraps auth login`');
    expect(text).toMatch(/restart/);
  });

  it('returns the problem text verbatim when the stored credential cannot be used', () => {
    const problem = 'Rerun `wraps selfhost login` for that instance, then restart the MCP server.';
    const config = makeApiConfig({ api: { problem } });
    const result = requireApi(config);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.content[0].text).toBe(problem);
  });

  it('is reached through loadConfig for a self-hosted session with no API URL', () => {
    mkdirSync(join(home, '.wraps'), { recursive: true });
    writeFileSync(
      join(home, '.wraps', 'config.json'),
      JSON.stringify({
        selfhost: { 'https://wraps.corp.example': { token: 'session-selfhost' } },
        activeInstance: 'https://wraps.corp.example',
      })
    );
    const config = loadConfig();
    expect(config.api).toEqual({ problem: expect.stringContaining('wraps selfhost login') });
    const result = requireApi(config);
    expect(result.ok).toBe(false);
  });
});
