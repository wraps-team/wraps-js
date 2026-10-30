import { describe, expect, it } from 'vitest';
import { apiRequest } from '../../api-client.ts';
import type { WrapsApiTarget } from '../../wraps-auth.ts';
import { mockApi } from './mock-api.ts';

// Proves the helper itself: unmatched requests are recorded, and the first unused route wins.
// Each test clears `unmatched` before it ends, because an unmatched request left in place would
// fail this test at teardown (that automatic failure is what the helper is for).

const API: WrapsApiTarget = {
  token: 'helper-test-token',
  tokenType: 'api-key',
  apiBase: 'https://api.wraps.test',
  source: 'env',
};

describe('mockApi()', () => {
  it('records an unmatched request, and an apiRequest against it is a tool error, not a pass', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/contacts', body: [] }]);

    const wrong = await apiRequest(API, { method: 'GET', path: '/v1/contacts/c_wrong' });
    expect(wrong.ok).toBe(false);
    expect(api.unmatched.map((c) => c.path)).toEqual(['/v1/contacts/c_wrong']);
    expect(() => api.verify()).toThrow(/unexpected Wraps API request/);

    // Clear the recorded miss so this test's own teardown does not fail on the deliberate miss.
    api.unmatched.splice(0);
    expect(() => api.verify()).not.toThrow();
  });

  it('treats a second request to a one-shot route as unmatched', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/contacts', body: [] }]);
    await apiRequest(API, { method: 'GET', path: '/v1/contacts' });
    const second = await apiRequest(API, { method: 'GET', path: '/v1/contacts' });
    expect(second.ok).toBe(false);
    expect(api.unmatched).toHaveLength(1);
    api.unmatched.splice(0);
  });

  it('matches a repeat route any number of times', async () => {
    const api = mockApi([{ method: 'GET', path: '/v1/contacts', body: [], repeat: true }]);
    await apiRequest(API, { method: 'GET', path: '/v1/contacts' });
    await apiRequest(API, { method: 'GET', path: '/v1/contacts' });
    expect(api.unmatched).toHaveLength(0);
    expect(api.calls).toHaveLength(2);
  });

  it('matches the first unused route, so a query-specific route listed first wins for its own page', async () => {
    const api = mockApi([
      { method: 'GET', path: '/v1/contacts', query: { cursor: 'page2' }, body: { data: ['b'] } },
      { method: 'GET', path: '/v1/contacts', body: { data: ['a'], nextCursor: 'page2' } },
    ]);

    const first = await apiRequest<{ data: string[] }>(API, {
      method: 'GET',
      path: '/v1/contacts',
    });
    expect(first.ok && first.data.data).toEqual(['a']);

    const second = await apiRequest<{ data: string[] }>(API, {
      method: 'GET',
      path: '/v1/contacts',
      query: { cursor: 'page2' },
    });
    expect(second.ok && second.data.data).toEqual(['b']);
    expect(api.calls.map((c) => c.query)).toEqual([{}, { cursor: 'page2' }]);
  });

  it('matches the pathname as sent, keeping percent-encoded ids', async () => {
    const api = mockApi([
      { method: 'DELETE', path: '/v1/suppressions/a%40example.com', status: 204 },
    ]);
    const result = await apiRequest(API, {
      method: 'DELETE',
      path: '/v1/suppressions/a%40example.com',
    });
    expect(result.ok).toBe(true);
    expect(api.calls[0].path).toBe('/v1/suppressions/a%40example.com');
  });
});
