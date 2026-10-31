import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWrapsApi } from '../wraps-auth.ts';

// Every test passes an explicit env object and a temp home. process.env is never read,
// so a developer's own WRAPS_API_KEY cannot leak into the result.

const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2001-01-01T00:00:00.000Z';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'wraps-auth-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function writeConfig(content: unknown): void {
  mkdirSync(join(home, '.wraps'), { recursive: true });
  writeFileSync(
    join(home, '.wraps', 'config.json'),
    typeof content === 'string' ? content : JSON.stringify(content)
  );
}

describe('resolveWrapsApi()', () => {
  it('returns undefined with no key and no config file', () => {
    expect(resolveWrapsApi({}, home)).toBeUndefined();
  });

  it('uses WRAPS_API_KEY as an api-key on the default SaaS base', () => {
    expect(resolveWrapsApi({ WRAPS_API_KEY: 'wk_live_abc' }, home)).toEqual({
      token: 'wk_live_abc',
      tokenType: 'api-key',
      apiBase: 'https://api.wraps.dev',
      source: 'env',
    });
  });

  it('reuses an unexpired SaaS session from the CLI config', () => {
    writeConfig({ auth: { token: 'session-saas', tokenType: 'session', expiresAt: FUTURE } });
    expect(resolveWrapsApi({}, home)).toEqual({
      token: 'session-saas',
      tokenType: 'session',
      apiBase: 'https://api.wraps.dev',
      source: 'cli-session',
    });
  });

  it('returns undefined for an expired SaaS session', () => {
    writeConfig({ auth: { token: 'session-saas', tokenType: 'session', expiresAt: PAST } });
    expect(resolveWrapsApi({}, home)).toBeUndefined();
  });

  it('prefers WRAPS_API_KEY over a stored session', () => {
    writeConfig({ auth: { token: 'session-saas', tokenType: 'session', expiresAt: FUTURE } });
    const api = resolveWrapsApi({ WRAPS_API_KEY: 'wk_live_env' }, home);
    expect(api).toMatchObject({ token: 'wk_live_env', tokenType: 'api-key', source: 'env' });
  });

  it('uses the active self-hosted session and its saved API URL', () => {
    writeConfig({
      auth: { token: 'session-saas', tokenType: 'session', expiresAt: FUTURE },
      selfhost: {
        'https://wraps.corp.example': {
          token: 'session-selfhost',
          tokenType: 'session',
          apiUrl: 'https://abc.lambda-url.us-east-1.on.aws/',
        },
      },
      activeInstance: 'https://wraps.corp.example',
    });
    expect(resolveWrapsApi({}, home)).toEqual({
      token: 'session-selfhost',
      tokenType: 'session',
      apiBase: 'https://abc.lambda-url.us-east-1.on.aws',
      source: 'cli-selfhost',
    });
  });

  it('adopts a lone self-hosted session when no SaaS token is stored', () => {
    writeConfig({
      selfhost: {
        'https://wraps.corp.example': {
          token: 'session-selfhost',
          apiUrl: 'https://api.corp.example',
        },
      },
    });
    expect(resolveWrapsApi({}, home)).toEqual({
      token: 'session-selfhost',
      tokenType: 'session',
      apiBase: 'https://api.corp.example',
      source: 'cli-selfhost',
    });
  });

  it('does not adopt a lone self-hosted session when a SaaS token is stored, even an expired one', () => {
    writeConfig({
      auth: { token: 'session-saas', tokenType: 'session', expiresAt: PAST },
      selfhost: {
        'https://wraps.corp.example': {
          token: 'session-selfhost',
          apiUrl: 'https://api.corp.example',
        },
      },
    });
    expect(resolveWrapsApi({}, home)).toBeUndefined();
  });

  it('does not guess between two self-hosted sessions without a pointer', () => {
    writeConfig({
      selfhost: {
        'https://a.example': { token: 'session-a', apiUrl: 'https://api.a.example' },
        'https://b.example': { token: 'session-b', apiUrl: 'https://api.b.example' },
      },
    });
    expect(resolveWrapsApi({}, home)).toBeUndefined();
  });

  it('falls back to SaaS when the active pointer names an instance with no session', () => {
    writeConfig({
      auth: { token: 'session-saas', tokenType: 'session', expiresAt: FUTURE },
      selfhost: {},
      activeInstance: 'https://gone.example',
    });
    expect(resolveWrapsApi({}, home)).toMatchObject({
      token: 'session-saas',
      apiBase: 'https://api.wraps.dev',
      source: 'cli-session',
    });
  });

  it('honours WRAPS_API_URL as the base and disables the self-hosted pointer', () => {
    writeConfig({
      auth: { token: 'session-saas', tokenType: 'session', expiresAt: FUTURE },
      selfhost: {
        'https://wraps.corp.example': {
          token: 'session-selfhost',
          apiUrl: 'https://api.corp.example',
        },
      },
      activeInstance: 'https://wraps.corp.example',
    });
    expect(resolveWrapsApi({ WRAPS_API_URL: 'https://staging.wraps.test/' }, home)).toEqual({
      token: 'session-saas',
      tokenType: 'session',
      apiBase: 'https://staging.wraps.test',
      source: 'cli-session',
    });
  });

  it('uses WRAPS_API_KEY on the WRAPS_API_URL base when both are set', () => {
    expect(
      resolveWrapsApi(
        { WRAPS_API_KEY: 'wk_live_env', WRAPS_API_URL: 'https://staging.wraps.test' },
        home
      )
    ).toEqual({
      token: 'wk_live_env',
      tokenType: 'api-key',
      apiBase: 'https://staging.wraps.test',
      source: 'env',
    });
  });

  it('uses WRAPS_API_KEY on the active self-hosted plane, with its saved URL', () => {
    writeConfig({
      selfhost: {
        'https://wraps.corp.example': {
          token: 'session-selfhost',
          apiUrl: 'https://api.corp.example',
        },
      },
      activeInstance: 'https://wraps.corp.example',
    });
    expect(resolveWrapsApi({ WRAPS_API_KEY: 'wk_live_env' }, home)).toEqual({
      token: 'wk_live_env',
      tokenType: 'api-key',
      apiBase: 'https://api.corp.example',
      source: 'env',
    });
  });

  it('reports a self-hosted session with no API URL as a problem, without scanning AWS', () => {
    writeConfig({
      selfhost: { 'https://wraps.corp.example': { token: 'session-selfhost-secret' } },
      activeInstance: 'https://wraps.corp.example',
    });
    const result = resolveWrapsApi({}, home);
    expect(result).toEqual({ problem: expect.stringContaining('wraps selfhost login') });
    expect(result).toEqual({ problem: expect.stringContaining('https://wraps.corp.example') });
  });

  it('never puts the token in the self-hosted problem text', () => {
    writeConfig({
      selfhost: { 'https://wraps.corp.example': { token: 'session-selfhost-secret' } },
      activeInstance: 'https://wraps.corp.example',
    });
    const result = resolveWrapsApi({}, home);
    expect(JSON.stringify(result)).not.toContain('session-selfhost-secret');
  });

  it('returns undefined for an expired self-hosted session, before checking the URL', () => {
    writeConfig({
      selfhost: {
        'https://wraps.corp.example': { token: 'session-selfhost', expiresAt: PAST },
      },
      activeInstance: 'https://wraps.corp.example',
    });
    expect(resolveWrapsApi({}, home)).toBeUndefined();
  });

  it('reads WRAPS_ORG_ID as orgId', () => {
    expect(
      resolveWrapsApi({ WRAPS_API_KEY: 'wk_live_env', WRAPS_ORG_ID: 'org_123' }, home)
    ).toEqual({
      token: 'wk_live_env',
      tokenType: 'api-key',
      apiBase: 'https://api.wraps.dev',
      orgId: 'org_123',
      source: 'env',
    });
  });

  it('leaves orgId out when WRAPS_ORG_ID is unset', () => {
    const api = resolveWrapsApi({ WRAPS_API_KEY: 'wk_live_env' }, home);
    expect(api).not.toHaveProperty('orgId');
  });

  it('treats a corrupt config file as no stored config, so startup still works', () => {
    writeConfig('{ this is not json');
    expect(resolveWrapsApi({}, home)).toBeUndefined();
    expect(resolveWrapsApi({ WRAPS_API_KEY: 'wk_live_env' }, home)).toMatchObject({
      source: 'env',
    });
  });

  it('ignores a WRAPS_HOME override, because the CLI has none', () => {
    const other = mkdtempSync(join(tmpdir(), 'wraps-auth-other-'));
    try {
      mkdirSync(join(other, '.wraps'), { recursive: true });
      writeFileSync(
        join(other, '.wraps', 'config.json'),
        JSON.stringify({ auth: { token: 'session-other', expiresAt: FUTURE } })
      );
      expect(resolveWrapsApi({ WRAPS_HOME: other }, home)).toBeUndefined();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
