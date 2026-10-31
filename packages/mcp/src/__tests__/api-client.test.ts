import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, seg } from '../api-client.ts';
import type { WrapsApiTarget } from '../wraps-auth.ts';
import { mockApi } from './helpers/mock-api.ts';

const BASE = 'https://api.wraps.test';
const KEY_API: WrapsApiTarget = {
  token: 'wk_live_SECRET_TOKEN',
  tokenType: 'api-key',
  apiBase: BASE,
  source: 'env',
};

function text(result: { ok: boolean; error?: { content: { text: string }[] } }): string {
  return result.ok ? '' : (result.error?.content[0]?.text ?? '');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest(): success and request shape', () => {
  it('returns status and parsed data on 2xx', async () => {
    const api = mockApi([
      { method: 'GET', path: '/v1/contacts/c_1', body: { id: 'c_1', email: 'a@example.com' } },
    ]);
    const result = await apiRequest<{ id: string; email: string }>(KEY_API, {
      method: 'GET',
      path: `/v1/contacts/${seg('c_1')}`,
    });
    expect(result).toEqual({ ok: true, status: 200, data: { id: 'c_1', email: 'a@example.com' } });
    expect(api.calls).toHaveLength(1);
  });

  it('sends Bearer auth, a user-agent with the package version, and accept JSON', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/contacts', body: [] }]);
    await apiRequest(KEY_API, { method: 'GET', path: '/v1/contacts' });
    const headers = api.calls[0].headers;
    expect(headers.authorization).toBe('Bearer wk_live_SECRET_TOKEN');
    expect(headers.accept).toBe('application/json');
    expect(headers['user-agent']).toMatch(/^wraps-mcp\/\d+\.\d+\.\d+/);
    expect(headers['x-organization-id']).toBeUndefined();
    expect(headers['content-type']).toBeUndefined();
  });

  it('sends x-organization-id when the target carries an orgId', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/contacts', body: [] }]);
    await apiRequest({ ...KEY_API, orgId: 'org_123' }, { method: 'GET', path: '/v1/contacts' });
    expect(api.calls[0].headers['x-organization-id']).toBe('org_123');
  });

  it('sends a JSON body with content-type only when a body is given', async () => {
    const api = mockApi([
      { method: 'POST', path: '/v1/contacts', status: 201, body: { id: 'c_2' } },
    ]);
    const result = await apiRequest(KEY_API, {
      method: 'POST',
      path: '/v1/contacts',
      body: { email: 'b@example.com', tags: ['vip'] },
    });
    expect(result.ok).toBe(true);
    expect(api.calls[0].headers['content-type']).toBe('application/json');
    expect(api.calls[0].body).toEqual({ email: 'b@example.com', tags: ['vip'] });
  });

  it('encodes ids passed through seg() into the path as sent', async () => {
    const api = mockApi([
      { method: 'GET', path: '/v1/contacts/a%2Fb%20c%3Fd', body: { id: 'a/b c?d' } },
    ]);
    const result = await apiRequest(KEY_API, {
      method: 'GET',
      path: `/v1/contacts/${seg('a/b c?d')}`,
    });
    expect(result.ok).toBe(true);
    expect(api.calls[0].path).toBe('/v1/contacts/a%2Fb%20c%3Fd');
  });

  it('skips undefined and null query values and stringifies numbers and booleans', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/contacts', body: [] }]);
    await apiRequest(KEY_API, {
      method: 'GET',
      path: '/v1/contacts',
      query: {
        limit: 20,
        cursor: undefined,
        includeDeleted: false,
        search: null,
        status: 'active',
      },
    });
    expect(api.calls[0].query).toEqual({ limit: '20', includeDeleted: 'false', status: 'active' });
  });

  it('returns ok with undefined data for an empty 204', async () => {
    mockApi([{ method: 'DELETE', path: '/v1/contacts/c_1', status: 204 }]);
    const result = await apiRequest(KEY_API, { method: 'DELETE', path: '/v1/contacts/c_1' });
    expect(result).toEqual({ ok: true, status: 204, data: undefined });
  });

  it('turns a non-JSON 2xx body into a tool error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>gateway</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
      )
    );
    const result = await apiRequest(KEY_API, { method: 'GET', path: '/v1/contacts' });
    expect(result.ok).toBe(false);
    expect(text(result)).toMatch(/not JSON/);
  });
});

describe('apiRequest(): error mapping', () => {
  it('maps 401 on an env key to a check-WRAPS_API_KEY message', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/contacts',
        status: 401,
        body: { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      },
    ]);
    const result = await apiRequest(KEY_API, { method: 'GET', path: '/v1/contacts' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_API_KEY');
    expect(text(result)).toContain('UNAUTHORIZED');
  });

  it('maps 401 on a CLI session to the wraps auth login fix', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/contacts',
        status: 401,
        body: { error: 'x', code: 'UNAUTHORIZED' },
      },
    ]);
    const session: WrapsApiTarget = { ...KEY_API, tokenType: 'session', source: 'cli-session' };
    const result = await apiRequest(session, { method: 'GET', path: '/v1/contacts' });
    expect(text(result)).toContain('`wraps auth login`');
  });

  it('maps 401 on a self-hosted session to the wraps selfhost login fix', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/contacts',
        status: 401,
        body: { error: 'x', code: 'UNAUTHORIZED' },
      },
    ]);
    const session: WrapsApiTarget = {
      ...KEY_API,
      tokenType: 'session',
      source: 'cli-selfhost',
      apiBase: 'https://api.corp.example',
    };
    const result = await apiRequest(session, { method: 'GET', path: '/v1/contacts' });
    expect(text(result)).toContain('`wraps selfhost login`');
    expect(text(result)).not.toContain('wraps auth login');
  });

  it('maps 403 to a role-or-plan message that includes the API message', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/contacts',
        status: 403,
        body: { error: 'Admin role required', code: 'FORBIDDEN' },
      },
    ]);
    const result = await apiRequest(KEY_API, { method: 'POST', path: '/v1/contacts', body: {} });
    expect(text(result)).toContain('Admin role required');
    expect(text(result)).toContain('(code: FORBIDDEN)');
    expect(text(result)).toMatch(/role .*API key's scopes.* or your plan/);
  });

  it('maps 404 to not found in this organization and includes the API message', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/contacts/c_missing',
        status: 404,
        body: { error: 'Contact not found', code: 'NOT_FOUND' },
      },
    ]);
    const result = await apiRequest(KEY_API, { method: 'GET', path: '/v1/contacts/c_missing' });
    expect(text(result)).toMatch(/Not found in this organization/);
    expect(text(result)).toContain('Contact not found');
    expect(text(result)).toContain('(code: NOT_FOUND)');
  });

  it('maps 400 and 422 to the API message verbatim', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/contacts',
        status: 400,
        body: { error: 'email must be a valid address', code: 'BAD_REQUEST' },
      },
      {
        method: 'POST',
        path: '/v1/contacts',
        status: 422,
        body: { error: 'tags must be an array', code: 'VALIDATION_FAILED' },
      },
    ]);
    const bad = await apiRequest(KEY_API, { method: 'POST', path: '/v1/contacts', body: {} });
    expect(text(bad)).toContain('email must be a valid address');
    const invalid = await apiRequest(KEY_API, { method: 'POST', path: '/v1/contacts', body: {} });
    expect(text(invalid)).toContain('tags must be an array');
    expect(text(invalid)).toContain('(code: VALIDATION_FAILED)');
  });

  it('maps 409 to a conflict message with the API message', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/segments',
        status: 409,
        body: { error: 'Name taken', code: 'CONFLICT' },
      },
    ]);
    const result = await apiRequest(KEY_API, { method: 'POST', path: '/v1/segments', body: {} });
    expect(text(result)).toMatch(/Conflict/);
    expect(text(result)).toContain('Name taken');
  });

  it('maps 429 to a retry-later message', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/contacts',
        status: 429,
        body: { error: 'Too many', code: 'RATE_LIMITED' },
      },
    ]);
    const result = await apiRequest(KEY_API, { method: 'GET', path: '/v1/contacts' });
    expect(text(result)).toMatch(/retry later/);
    expect(text(result)).toContain('(code: RATE_LIMITED)');
  });

  it('reads a 409 message field when the route has no error field', async () => {
    mockApi([
      {
        method: 'DELETE',
        path: '/v1/segments/s_1',
        status: 409,
        body: { message: 'Segment is targeted by a live broadcast', code: 'CONFLICT' },
      },
    ]);
    const result = await apiRequest(KEY_API, { method: 'DELETE', path: '/v1/segments/s_1' });
    expect(text(result)).toContain('Segment is targeted by a live broadcast');
    expect(text(result)).toContain('(code: CONFLICT)');
    expect(text(result)).toMatch(/Conflict/);
    expect(text(result)).toMatch(/Read it again, then retry/);
    expect(text(result)).toMatch(/resolve the conflict the API describes/);
    expect(text(result)).not.toMatch(/already exists/);
  });

  it('reads the 409 error field when present', async () => {
    mockApi([
      {
        method: 'PATCH',
        path: '/v1/segments/s_2',
        status: 409,
        body: { error: 'Name already used by another segment', code: 'CONFLICT' },
      },
    ]);
    const result = await apiRequest(KEY_API, {
      method: 'PATCH',
      path: '/v1/segments/s_2',
      body: { name: 'x' },
    });
    expect(text(result)).toContain('Name already used by another segment');
    expect(text(result)).toMatch(/resolve the conflict the API describes/);
  });

  it('appends the API error text to a 429 and keeps the rate-limit wording', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/events',
        status: 429,
        body: { error: 'event_limit_exceeded', code: 'RATE_LIMITED' },
      },
    ]);
    const result = await apiRequest(KEY_API, { method: 'POST', path: '/v1/events', body: {} });
    expect(text(result)).toContain('Rate limited by the Wraps API');
    expect(text(result)).toContain('retry later');
    expect(text(result)).toContain('(code: RATE_LIMITED)');
    expect(text(result)).toContain('event_limit_exceeded');
  });

  it('includes the requestId from the body on a 5xx', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/contacts',
        status: 500,
        body: { error: 'Internal server error', code: 'INTERNAL_ERROR', requestId: 'req-body-1' },
      },
    ]);
    const result = await apiRequest(KEY_API, { method: 'GET', path: '/v1/contacts' });
    expect(text(result)).toContain('req-body-1');
    expect(text(result)).toContain('(code: INTERNAL_ERROR)');
    expect(text(result)).toMatch(/Retry later/);
  });

  it('falls back to the x-request-id header on a 5xx with no requestId in the body', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/contacts',
        status: 503,
        body: { error: 'Service unavailable' },
        headers: { 'x-request-id': 'req-header-9' },
      },
    ]);
    const result = await apiRequest(KEY_API, { method: 'GET', path: '/v1/contacts' });
    expect(text(result)).toContain('req-header-9');
    expect(text(result)).toContain('HTTP 503');
  });

  it('never puts the token in any error text', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/v1/a',
        status: 401,
        body: { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      },
      {
        method: 'GET',
        path: '/v1/b',
        status: 500,
        body: { error: 'boom', code: 'INTERNAL_ERROR' },
      },
      { method: 'GET', path: '/v1/c', status: 418, body: null },
    ]);
    for (const path of ['/v1/a', '/v1/b', '/v1/c']) {
      const result = await apiRequest(KEY_API, { method: 'GET', path });
      expect(text(result)).not.toContain('wk_live_SECRET_TOKEN');
    }
  });
});

describe('apiRequest(): timeout and network failure', () => {
  it('passes an abort signal and maps a timeout to a timeout message', async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiRequest(KEY_API, { method: 'GET', path: '/v1/contacts' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result.ok).toBe(false);
    expect(text(result)).toMatch(/did not answer .* within 30 seconds/);
  });

  it('maps an AbortError to the same timeout message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError');
      })
    );
    const result = await apiRequest(KEY_API, { method: 'GET', path: '/v1/contacts' });
    expect(text(result)).toMatch(/within 30 seconds/);
  });

  it('maps a network failure to a check-connection message, without the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );
    const result = await apiRequest(KEY_API, { method: 'GET', path: '/v1/contacts' });
    expect(result.ok).toBe(false);
    expect(text(result)).toMatch(/Could not reach the Wraps API/);
    expect(text(result)).toContain('WRAPS_API_URL');
    expect(text(result)).not.toContain('wk_live_SECRET_TOKEN');
  });

  it('reports an invalid base URL as a tool error instead of throwing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await apiRequest(
      { ...KEY_API, apiBase: 'not a url' },
      { method: 'GET', path: '/v1/contacts' }
    );
    expect(result.ok).toBe(false);
    expect(text(result)).toMatch(/not a valid URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
