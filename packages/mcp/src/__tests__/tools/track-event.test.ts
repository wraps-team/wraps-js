import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerTrackEvent } from '../../tools/track-event.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

const ACCEPTED = {
  success: true,
  contactCreated: false,
  workflowsTriggered: 2,
  executionsResumed: 1,
};

describe('track_event', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('posts the event with confirm removed and returns pinned structuredContent', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/events',
        body: ACCEPTED,
      },
    ]);
    client = await connectTool(registerTrackEvent, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'track_event',
      arguments: {
        name: 'purchase.completed',
        contactId: 'ctc_1',
        properties: { amount: 4200 },
        confirm: true,
      },
    })) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: 'ctc_1',
      success: true,
      contactCreated: false,
      workflowsTriggered: 2,
      executionsResumed: 1,
    });
    expect(result.content[0].text).toContain('Workflows triggered: 2');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe('POST');
    expect(api.calls[0].path).toBe('/v1/events');
    expect(api.calls[0].body).toEqual({
      name: 'purchase.completed',
      contactId: 'ctc_1',
      properties: { amount: 4200 },
    });
  });

  it('identifies a contact by email with createIfMissing and reports the created contact', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/events',
        body: { ...ACCEPTED, contactCreated: true, workflowsTriggered: 0, executionsResumed: 0 },
      },
    ]);
    client = await connectTool(registerTrackEvent, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'track_event',
      arguments: {
        name: 'signup.started',
        contactEmail: 'new@example.com',
        contactName: 'New',
        createIfMissing: true,
        confirm: true,
      },
    })) as ToolResult;

    expect(result.structuredContent).toEqual({
      id: null,
      success: true,
      contactCreated: true,
      workflowsTriggered: 0,
      executionsResumed: 0,
    });
    expect(api.calls[0].body).toEqual({
      name: 'signup.started',
      contactEmail: 'new@example.com',
      contactName: 'New',
      createIfMissing: true,
    });
  });

  it('maps an unknown contact (API 400) to an isError result that names the fix', async () => {
    const api = mockApi([
      {
        method: 'POST',
        path: '/v1/events',
        status: 400,
        body: { success: false, error: 'Contact not found' },
      },
    ]);
    client = await connectTool(registerTrackEvent, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'track_event',
      arguments: { name: 'purchase.completed', contactEmail: 'ghost@example.com', confirm: true },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Contact not found');
    expect(result.content[0].text).toContain('Fix the arguments and retry');
    expect(result.structuredContent).toBeUndefined();
    expect(api.calls).toHaveLength(1);
  });

  it('pins the current F0 helper text for a 429, which does not separate the event allowance case (report deviation 9)', async () => {
    mockApi([
      {
        method: 'POST',
        path: '/v1/events',
        status: 429,
        body: { error: 'event_limit_exceeded', code: 'EVENT_LIMIT_EXCEEDED' },
      },
    ]);
    client = await connectTool(registerTrackEvent, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'track_event',
      arguments: { name: 'purchase.completed', contactId: 'ctc_1', confirm: true },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Rate limited by the Wraps API');
    expect(result.content[0].text).toContain('retry later');
  });

  it('refuses without confirm, through the SDK schema, and sends no request', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/events', body: ACCEPTED }]);
    client = await connectTool(registerTrackEvent, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'track_event',
      arguments: { name: 'purchase.completed', contactId: 'ctc_1' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('confirm must be true');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses confirm: false without sending a request', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/events', body: ACCEPTED }]);
    client = await connectTool(registerTrackEvent, makeApiConfig({ writeEnabled: true }));

    const result = (await client.callTool({
      name: 'track_event',
      arguments: { name: 'purchase.completed', contactId: 'ctc_1', confirm: false },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('refuses when write mode is disabled, even with confirm: true, and sends no request', async () => {
    const api = mockApi([{ method: 'POST', path: '/v1/events', body: ACCEPTED }]);
    client = await connectTool(registerTrackEvent, makeApiConfig({ writeEnabled: false }));

    const result = (await client.callTool({
      name: 'track_event',
      arguments: { name: 'purchase.completed', contactId: 'ctc_1', confirm: true },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('WRAPS_WRITE_ENABLED=true');
    expect(result.content[0].text).toContain('Nothing was changed');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses without a credential and sends no request', async () => {
    const api = mockApi([]);
    client = await connectTool(
      registerTrackEvent,
      makeApiConfig({ writeEnabled: true, api: null })
    );

    const result = (await client.callTool({
      name: 'track_event',
      arguments: { name: 'purchase.completed', contactId: 'ctc_1', confirm: true },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('is annotated as destructive, not read-only', async () => {
    mockApi([]);
    client = await connectTool(registerTrackEvent, makeApiConfig());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'track_event');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});
