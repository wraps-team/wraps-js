import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendBatch } from '../src/batch';
import { ValidationError } from '../src/errors';
import type { SendBatchParams } from '../src/types';

// Mock renderReactEmail
vi.mock('../src/react', () => ({
  renderReactEmail: vi.fn().mockResolvedValue({
    html: '<p>rendered react</p>',
    text: 'rendered react',
  }),
}));

function createMockSESv2Client(responses: Array<{ BulkEmailEntryResults: Array<{ Status: string; MessageId?: string; Error?: string }> }>) {
  let callIndex = 0;
  return {
    send: vi.fn().mockImplementation(() => {
      const response = responses[callIndex++];
      if (!response) {
        throw new Error('No more mock responses');
      }
      return Promise.resolve(response);
    }),
    destroy: vi.fn(),
  } as any;
}

function createErrorClient(error: Error) {
  return {
    send: vi.fn().mockRejectedValue(error),
    destroy: vi.fn(),
  } as any;
}

describe('sendBatch', () => {
  const baseParams: SendBatchParams = {
    from: 'sender@example.com',
    entries: [
      { to: 'alice@example.com', subject: 'Hi Alice', html: '<p>Hello Alice</p>' },
      { to: 'bob@example.com', subject: 'Hi Bob', html: '<p>Hello Bob</p>', text: 'Hello Bob' },
    ],
  };

  describe('happy path', () => {
    it('should send 2 entries successfully', async () => {
      const client = createMockSESv2Client([{
        BulkEmailEntryResults: [
          { Status: 'SUCCESS', MessageId: 'msg-1' },
          { Status: 'SUCCESS', MessageId: 'msg-2' },
        ],
      }]);

      const result = await sendBatch(client, baseParams);

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({
        index: 0,
        messageId: 'msg-1',
        status: 'success',
        error: undefined,
      });
      expect(result.results[1]).toEqual({
        index: 1,
        messageId: 'msg-2',
        status: 'success',
        error: undefined,
      });
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('should pass from, replyTo, tags, and configurationSetName', async () => {
      const client = createMockSESv2Client([{
        BulkEmailEntryResults: [{ Status: 'SUCCESS', MessageId: 'msg-1' }],
      }]);

      await sendBatch(client, {
        from: { email: 'sender@example.com', name: 'Sender' },
        entries: [{ to: 'alice@example.com', subject: 'Hi', html: '<p>Hi</p>' }],
        replyTo: 'reply@example.com',
        tags: { campaign: 'welcome' },
        configurationSetName: 'my-config-set',
      });

      const command = client.send.mock.calls[0][0];
      expect(command.input.FromEmailAddress).toBe('"Sender" <sender@example.com>');
      expect(command.input.ReplyToAddresses).toEqual(['reply@example.com']);
      expect(command.input.DefaultEmailTags).toEqual([{ Name: 'campaign', Value: 'welcome' }]);
      expect(command.input.ConfigurationSetName).toBe('my-config-set');
    });

    it('should pass per-entry replacement tags', async () => {
      const client = createMockSESv2Client([{
        BulkEmailEntryResults: [
          { Status: 'SUCCESS', MessageId: 'msg-1' },
          { Status: 'SUCCESS', MessageId: 'msg-2' },
        ],
      }]);

      await sendBatch(client, {
        from: 'sender@example.com',
        entries: [
          { to: 'alice@example.com', subject: 'Hi', html: '<p>Hi</p>', tags: { user: 'alice' } },
          { to: 'bob@example.com', subject: 'Hi', html: '<p>Hi</p>' },
        ],
        tags: { campaign: 'test' },
      });

      const command = client.send.mock.calls[0][0];
      const entries = command.input.BulkEmailEntries;
      expect(entries[0].ReplacementTags).toEqual([{ Name: 'user', Value: 'alice' }]);
      expect(entries[1].ReplacementTags).toBeUndefined();
    });
  });

  describe('react entries', () => {
    it('should render react components', async () => {
      const { renderReactEmail } = await import('../src/react');
      const client = createMockSESv2Client([{
        BulkEmailEntryResults: [{ Status: 'SUCCESS', MessageId: 'msg-1' }],
      }]);

      const fakeReactElement = { type: 'div', props: {} } as any;

      await sendBatch(client, {
        from: 'sender@example.com',
        entries: [
          { to: 'alice@example.com', subject: 'Hi', react: fakeReactElement },
        ],
      });

      expect(renderReactEmail).toHaveBeenCalledWith(fakeReactElement);

      const command = client.send.mock.calls[0][0];
      const templateData = JSON.parse(
        command.input.BulkEmailEntries[0].ReplacementEmailContent.ReplacementTemplate.ReplacementTemplateData
      );
      expect(templateData.htmlContent).toBe('<p>rendered react</p>');
      expect(templateData.textContent).toBe('rendered react');
    });

    it('should use provided text over rendered text', async () => {
      const client = createMockSESv2Client([{
        BulkEmailEntryResults: [{ Status: 'SUCCESS', MessageId: 'msg-1' }],
      }]);

      const fakeReactElement = { type: 'div', props: {} } as any;

      await sendBatch(client, {
        from: 'sender@example.com',
        entries: [
          { to: 'alice@example.com', subject: 'Hi', react: fakeReactElement, text: 'custom text' },
        ],
      });

      const command = client.send.mock.calls[0][0];
      const templateData = JSON.parse(
        command.input.BulkEmailEntries[0].ReplacementEmailContent.ReplacementTemplate.ReplacementTemplateData
      );
      expect(templateData.textContent).toBe('custom text');
    });
  });

  describe('chunking', () => {
    it('should split 75 entries into 50 + 25 chunks', async () => {
      const entries = Array.from({ length: 75 }, (_, i) => ({
        to: `user${i}@example.com`,
        subject: `Subject ${i}`,
        html: `<p>Content ${i}</p>`,
      }));

      const client = createMockSESv2Client([
        {
          BulkEmailEntryResults: Array.from({ length: 50 }, (_, i) => ({
            Status: 'SUCCESS',
            MessageId: `msg-${i}`,
          })),
        },
        {
          BulkEmailEntryResults: Array.from({ length: 25 }, (_, i) => ({
            Status: 'SUCCESS',
            MessageId: `msg-${50 + i}`,
          })),
        },
      ]);

      const result = await sendBatch(client, { from: 'sender@example.com', entries });

      expect(client.send).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(75);
      expect(result.successCount).toBe(75);
      expect(result.failureCount).toBe(0);

      // Verify indices are correct
      expect(result.results[0].index).toBe(0);
      expect(result.results[49].index).toBe(49);
      expect(result.results[50].index).toBe(50);
      expect(result.results[74].index).toBe(74);
    });

    it('should handle exactly 50 entries in a single chunk', async () => {
      const entries = Array.from({ length: 50 }, (_, i) => ({
        to: `user${i}@example.com`,
        subject: `Subject ${i}`,
        html: `<p>Content ${i}</p>`,
      }));

      const client = createMockSESv2Client([{
        BulkEmailEntryResults: Array.from({ length: 50 }, (_, i) => ({
          Status: 'SUCCESS',
          MessageId: `msg-${i}`,
        })),
      }]);

      const result = await sendBatch(client, { from: 'sender@example.com', entries });

      expect(client.send).toHaveBeenCalledTimes(1);
      expect(result.results).toHaveLength(50);
      expect(result.successCount).toBe(50);
    });
  });

  describe('validation', () => {
    it('should throw on empty entries', async () => {
      const client = createMockSESv2Client([]);

      await expect(
        sendBatch(client, { from: 'sender@example.com', entries: [] })
      ).rejects.toThrow(ValidationError);
      await expect(
        sendBatch(client, { from: 'sender@example.com', entries: [] })
      ).rejects.toThrow('entries array must not be empty');
    });

    it('should throw on >100 entries', async () => {
      const client = createMockSESv2Client([]);
      const entries = Array.from({ length: 101 }, (_, i) => ({
        to: `user${i}@example.com`,
        subject: `Subject ${i}`,
        html: `<p>${i}</p>`,
      }));

      await expect(
        sendBatch(client, { from: 'sender@example.com', entries })
      ).rejects.toThrow(ValidationError);
      await expect(
        sendBatch(client, { from: 'sender@example.com', entries })
      ).rejects.toThrow('Maximum 100 entries');
    });

    it('should throw on missing subject', async () => {
      const client = createMockSESv2Client([]);

      await expect(
        sendBatch(client, {
          from: 'sender@example.com',
          entries: [{ to: 'alice@example.com', subject: '', html: '<p>Hi</p>' }],
        })
      ).rejects.toThrow('missing required field "subject"');
    });

    it('should throw on missing to', async () => {
      const client = createMockSESv2Client([]);

      await expect(
        sendBatch(client, {
          from: 'sender@example.com',
          entries: [{ to: '', subject: 'Hi', html: '<p>Hi</p>' }],
        })
      ).rejects.toThrow('missing required field "to"');
    });

    it('should throw on missing content (no html, text, or react)', async () => {
      const client = createMockSESv2Client([]);

      await expect(
        sendBatch(client, {
          from: 'sender@example.com',
          entries: [{ to: 'alice@example.com', subject: 'Hi' }],
        })
      ).rejects.toThrow('must provide at least one of "html", "text", or "react"');
    });

    it('should throw on html + react conflict', async () => {
      const client = createMockSESv2Client([]);
      const fakeReactElement = { type: 'div', props: {} } as any;

      await expect(
        sendBatch(client, {
          from: 'sender@example.com',
          entries: [{
            to: 'alice@example.com',
            subject: 'Hi',
            html: '<p>Hi</p>',
            react: fakeReactElement,
          }],
        })
      ).rejects.toThrow('cannot provide both "html" and "react"');
    });
  });

  describe('partial failure', () => {
    it('should report mixed success/failure per-entry results', async () => {
      const client = createMockSESv2Client([{
        BulkEmailEntryResults: [
          { Status: 'SUCCESS', MessageId: 'msg-1' },
          { Status: 'FAILED', Error: 'Address blacklisted' },
          { Status: 'SUCCESS', MessageId: 'msg-3' },
        ],
      }]);

      const result = await sendBatch(client, {
        from: 'sender@example.com',
        entries: [
          { to: 'alice@example.com', subject: 'Hi', html: '<p>Hi</p>' },
          { to: 'blocked@example.com', subject: 'Hi', html: '<p>Hi</p>' },
          { to: 'charlie@example.com', subject: 'Hi', html: '<p>Hi</p>' },
        ],
      });

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.results[1]).toEqual({
        index: 1,
        messageId: undefined,
        status: 'failure',
        error: 'Address blacklisted',
      });
    });
  });

  describe('chunk-level error', () => {
    it('should mark all entries in a failed chunk as failed and continue', async () => {
      const entries = Array.from({ length: 75 }, (_, i) => ({
        to: `user${i}@example.com`,
        subject: `Subject ${i}`,
        html: `<p>Content ${i}</p>`,
      }));

      // First chunk fails, second succeeds
      let callIndex = 0;
      const client = {
        send: vi.fn().mockImplementation(() => {
          callIndex++;
          if (callIndex === 1) {
            return Promise.reject(Object.assign(new Error('Throttled'), {
              $metadata: { requestId: 'req-1' },
              $retryable: { throttling: true },
              name: 'TooManyRequestsException',
            }));
          }
          return Promise.resolve({
            BulkEmailEntryResults: Array.from({ length: 25 }, (_, i) => ({
              Status: 'SUCCESS',
              MessageId: `msg-${50 + i}`,
            })),
          });
        }),
        destroy: vi.fn(),
      } as any;

      const result = await sendBatch(client, { from: 'sender@example.com', entries });

      expect(client.send).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(75);
      expect(result.failureCount).toBe(50);
      expect(result.successCount).toBe(25);

      // First 50 should all be failures
      for (let i = 0; i < 50; i++) {
        expect(result.results[i].status).toBe('failure');
        expect(result.results[i].index).toBe(i);
        expect(result.results[i].error).toBe('Chunk-level SES error');
      }

      // Next 25 should be successes
      for (let i = 50; i < 75; i++) {
        expect(result.results[i].status).toBe('success');
        expect(result.results[i].index).toBe(i);
      }
    });
  });

  describe('text-only entries', () => {
    it('should accept entries with only text (no html)', async () => {
      const client = createMockSESv2Client([{
        BulkEmailEntryResults: [{ Status: 'SUCCESS', MessageId: 'msg-1' }],
      }]);

      const result = await sendBatch(client, {
        from: 'sender@example.com',
        entries: [
          { to: 'alice@example.com', subject: 'Hi', text: 'Plain text only' },
        ],
      });

      expect(result.successCount).toBe(1);

      const command = client.send.mock.calls[0][0];
      const templateData = JSON.parse(
        command.input.BulkEmailEntries[0].ReplacementEmailContent.ReplacementTemplate.ReplacementTemplateData
      );
      expect(templateData.htmlContent).toBe('');
      expect(templateData.textContent).toBe('Plain text only');
    });
  });

  describe('EmailAddress objects', () => {
    it('should normalize EmailAddress objects for to and from', async () => {
      const client = createMockSESv2Client([{
        BulkEmailEntryResults: [{ Status: 'SUCCESS', MessageId: 'msg-1' }],
      }]);

      await sendBatch(client, {
        from: { email: 'sender@example.com', name: 'My App' },
        entries: [
          { to: { email: 'alice@example.com', name: 'Alice' }, subject: 'Hi', html: '<p>Hi</p>' },
        ],
      });

      const command = client.send.mock.calls[0][0];
      expect(command.input.FromEmailAddress).toBe('"My App" <sender@example.com>');
      expect(command.input.BulkEmailEntries[0].Destination.ToAddresses).toEqual(['"Alice" <alice@example.com>']);
    });
  });
});
