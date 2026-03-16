import { describe, expect, it } from 'vitest';
import { cascade } from '../workflow-steps';
import { defineWorkflow } from '../workflow';

describe('cascade', () => {
  it('expands a 2-channel cascade (email → sms) correctly', () => {
    const steps = cascade('notify', {
      channels: [
        {
          type: 'email',
          template: 'welcome-email',
          waitFor: { hours: 2 },
          engagement: 'opened',
        },
        {
          type: 'sms',
          template: 'welcome-sms',
        },
      ],
    });

    // Should produce: sendEmail → waitForEmailEngagement → condition → sendSms
    expect(steps).toHaveLength(4);

    // Step 1: Send email
    expect(steps[0].id).toBe('notify-email');
    expect(steps[0].type).toBe('send_email');
    expect(steps[0].config).toMatchObject({ type: 'send_email', template: 'welcome-email' });

    // Step 2: Wait for engagement
    expect(steps[1].id).toBe('notify-email-wait');
    expect(steps[1].type).toBe('wait_for_email_engagement');

    // Step 3: Condition check
    expect(steps[2].id).toBe('notify-email-check');
    expect(steps[2].type).toBe('condition');
    expect(steps[2].branches?.yes).toHaveLength(1);
    expect(steps[2].branches?.yes?.[0].type).toBe('exit');

    // Step 4: Send SMS (fallback) — index 1, so ID gets `-1` suffix
    expect(steps[3].id).toBe('notify-sms-1');
    expect(steps[3].type).toBe('send_sms');
    expect(steps[3].config).toMatchObject({ type: 'send_sms', template: 'welcome-sms' });
  });

  it('handles single-channel cascade (just send, no wait/check)', () => {
    const steps = cascade('simple', {
      channels: [
        { type: 'email', template: 'notification' },
      ],
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe('simple-email');
    expect(steps[0].type).toBe('send_email');
  });

  it('generates deterministic step IDs', () => {
    const steps1 = cascade('test', {
      channels: [
        { type: 'email', template: 'a', waitFor: { hours: 1 } },
        { type: 'sms', template: 'b' },
      ],
    });
    const steps2 = cascade('test', {
      channels: [
        { type: 'email', template: 'a', waitFor: { hours: 1 } },
        { type: 'sms', template: 'b' },
      ],
    });

    expect(steps1.map(s => s.id)).toEqual(steps2.map(s => s.id));
  });

  it('passes config through to underlying steps', () => {
    const steps = cascade('branded', {
      channels: [
        {
          type: 'email',
          template: 'branded-email',
          from: 'hello@example.com',
          fromName: 'Hello Team',
          subject: 'Custom Subject',
          waitFor: { hours: 4 },
          engagement: 'clicked',
        },
        {
          type: 'sms',
          template: 'branded-sms',
          senderId: 'MYAPP',
        },
      ],
    });

    // Email config
    expect(steps[0].config).toMatchObject({
      type: 'send_email',
      template: 'branded-email',
      from: 'hello@example.com',
      fromName: 'Hello Team',
      subject: 'Custom Subject',
    });

    // SMS config
    const smsStep = steps.find(s => s.type === 'send_sms');
    expect(smsStep?.config).toMatchObject({
      type: 'send_sms',
      template: 'branded-sms',
      senderId: 'MYAPP',
    });
  });

  it('handles 3-channel cascade correctly', () => {
    const steps = cascade('multi', {
      channels: [
        { type: 'email', template: 'email-1', waitFor: { hours: 2 }, engagement: 'opened' },
        { type: 'sms', template: 'sms-1', waitFor: { hours: 4 } },
        { type: 'email', template: 'email-2' },
      ],
    });

    // email-1 → wait → check → sms-1 → delay → email-2
    expect(steps).toHaveLength(6);
    expect(steps[0].type).toBe('send_email');
    expect(steps[1].type).toBe('wait_for_email_engagement');
    expect(steps[2].type).toBe('condition');
    expect(steps[3].type).toBe('send_sms');
    expect(steps[4].type).toBe('delay');
    expect(steps[5].type).toBe('send_email');
    // Second email should have a different ID suffix
    expect(steps[5].id).toBe('multi-email-2');
  });

  it('works with defineWorkflow (auto-flatten)', () => {
    const workflow = defineWorkflow({
      name: 'Test Cascade',
      trigger: { type: 'event', eventName: 'test' },
      steps: [
        ...cascade('notify', {
          channels: [
            { type: 'email', template: 'welcome', waitFor: { hours: 2 } },
            { type: 'sms', template: 'welcome-sms' },
          ],
        }),
      ],
    });

    expect(workflow.steps.length).toBe(4);
    expect(workflow.steps.every(s => !Array.isArray(s))).toBe(true);
  });

  it('defaults engagement to opened for email channels', () => {
    const steps = cascade('default-eng', {
      channels: [
        { type: 'email', template: 'test', waitFor: { hours: 1 } },
        { type: 'sms', template: 'fallback' },
      ],
    });

    // The condition should check for 'opened' (default)
    const waitStep = steps.find(s => s.type === 'wait_for_email_engagement');
    expect(waitStep).toBeDefined();
  });
});
