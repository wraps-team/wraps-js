/**
 * Workflow Step Helper Functions
 *
 * Ergonomic helpers for defining workflow steps declaratively.
 * These functions return step definitions that can be used in `defineWorkflow()`.
 */

import type {
  CascadeConfig,
  ConditionStepConfig,
  DurationConfig,
  ExitStepConfig,
  SendEmailStepConfig,
  SendSmsStepConfig,
  StepDefinition,
  TopicStepConfig,
  UpdateContactStepConfig,
  WaitForEmailEngagementStepConfig,
  WaitForEventStepConfig,
  WebhookStepConfig,
} from './workflow';

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert DurationConfig to delay step config (amount + unit)
 */
function normalizeDuration(duration: DurationConfig): {
  amount: number;
  unit: 'minutes' | 'hours' | 'days' | 'weeks';
} {
  if (duration.days !== undefined) {
    return { amount: duration.days, unit: 'days' };
  }
  if (duration.hours !== undefined) {
    return { amount: duration.hours, unit: 'hours' };
  }
  if (duration.minutes !== undefined) {
    return { amount: duration.minutes, unit: 'minutes' };
  }
  // Default to 1 hour if nothing specified
  return { amount: 1, unit: 'hours' };
}

/**
 * Convert DurationConfig to seconds for timeout values
 */
function durationToSeconds(duration?: DurationConfig): number | undefined {
  if (!duration) return undefined;

  let seconds = 0;
  if (duration.days) seconds += duration.days * 24 * 60 * 60;
  if (duration.hours) seconds += duration.hours * 60 * 60;
  if (duration.minutes) seconds += duration.minutes * 60;

  return seconds > 0 ? seconds : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL STEPS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send an email using a template or inline content.
 *
 * @example
 * ```ts
 * // Using a template
 * sendEmail('welcome', { template: 'welcome-email' })
 *
 * // With overrides
 * sendEmail('promo', {
 *   template: 'promo-email',
 *   from: 'marketing@example.com',
 *   fromName: 'Marketing Team',
 * })
 * ```
 */
export function sendEmail(
  id: string,
  config: SendEmailStepConfig & { name?: string }
): StepDefinition {
  const { name, ...stepConfig } = config;
  return {
    id,
    type: 'send_email',
    name: name ?? `Send email: ${config.template || 'custom'}`,
    config: { type: 'send_email', ...stepConfig },
  };
}

/**
 * Send an SMS using a template or inline message.
 *
 * @example
 * ```ts
 * // Using a template
 * sendSms('reminder', { template: 'appointment-reminder' })
 *
 * // Inline message
 * sendSms('otp', { message: 'Your code is {{otp}}' })
 * ```
 */
export function sendSms(id: string, config: SendSmsStepConfig & { name?: string }): StepDefinition {
  const { name, ...stepConfig } = config;
  return {
    id,
    type: 'send_sms',
    name: name ?? `Send SMS: ${config.template || 'custom'}`,
    config: { type: 'send_sms', ...stepConfig },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROL FLOW STEPS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wait for a specified duration before continuing.
 *
 * @example
 * ```ts
 * delay('wait-1-day', { days: 1 })
 * delay('wait-2-hours', { hours: 2 })
 * delay('wait-30-min', { minutes: 30 })
 * ```
 */
export function delay(id: string, duration: DurationConfig & { name?: string }): StepDefinition {
  const { name, ...durationConfig } = duration;
  const normalized = normalizeDuration(durationConfig);
  return {
    id,
    type: 'delay',
    name: name ?? `Wait ${normalized.amount} ${normalized.unit}`,
    config: { type: 'delay', ...normalized },
  };
}

/**
 * Branch the workflow based on a condition.
 *
 * @example
 * ```ts
 * condition('check-activated', {
 *   field: 'contact.hasActivated',
 *   operator: 'equals',
 *   value: true,
 *   branches: {
 *     yes: [exit('already-active')],
 *     no: [sendEmail('activation-reminder', { template: 'activate' })],
 *   },
 * })
 * ```
 */
export function condition(
  id: string,
  config: ConditionStepConfig & { name?: string }
): StepDefinition {
  const { branches, name, ...conditionConfig } = config;
  return {
    id,
    type: 'condition',
    name: name ?? `Check: ${config.field} ${config.operator}`,
    config: { type: 'condition', ...conditionConfig },
    branches,
  };
}

/**
 * Wait for a specific event before continuing.
 *
 * @example
 * ```ts
 * waitForEvent('wait-for-purchase', {
 *   eventName: 'purchase_completed',
 *   timeout: { days: 7 },
 * })
 * ```
 */
export function waitForEvent(
  id: string,
  config: WaitForEventStepConfig & { name?: string }
): StepDefinition {
  const { name, timeout, ...eventConfig } = config;
  return {
    id,
    type: 'wait_for_event',
    name: name ?? `Wait for: ${config.eventName}`,
    config: {
      type: 'wait_for_event',
      eventName: eventConfig.eventName,
      timeoutSeconds: durationToSeconds(timeout),
    },
  };
}

/**
 * Wait for engagement with a previous email step.
 *
 * @example
 * ```ts
 * waitForEmailEngagement('wait-for-open', {
 *   emailStepId: 'welcome',
 *   engagementType: 'opened',
 *   timeout: { days: 3 },
 * })
 * ```
 */
export function waitForEmailEngagement(
  id: string,
  config: WaitForEmailEngagementStepConfig & { name?: string }
): StepDefinition {
  const { name, timeout, emailStepId, engagementType } = config;
  return {
    id,
    type: 'wait_for_email_engagement',
    name: name ?? `Wait for email ${engagementType}: ${emailStepId}`,
    config: {
      type: 'wait_for_email_engagement',
      timeoutSeconds: durationToSeconds(timeout),
    },
  };
}

/**
 * Exit the workflow.
 *
 * @example
 * ```ts
 * exit('completed')
 * exit('cancelled', { reason: 'User unsubscribed', markAs: 'cancelled' })
 * ```
 */
export function exit(id: string, config?: ExitStepConfig & { name?: string }): StepDefinition {
  const { name, ...exitConfig } = config ?? {};
  return {
    id,
    type: 'exit',
    name: name ?? 'Exit',
    config: { type: 'exit', ...exitConfig },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION STEPS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update contact fields.
 *
 * @example
 * ```ts
 * updateContact('mark-welcomed', {
 *   updates: [
 *     { field: 'welcomeEmailSent', operation: 'set', value: true },
 *     { field: 'emailCount', operation: 'increment', value: 1 },
 *   ],
 * })
 * ```
 */
export function updateContact(
  id: string,
  config: Omit<UpdateContactStepConfig, 'type'> & { name?: string }
): StepDefinition {
  const { name, ...updateConfig } = config;
  return {
    id,
    type: 'update_contact',
    name: name ?? 'Update contact',
    config: { type: 'update_contact', ...updateConfig },
  };
}

/**
 * Subscribe a contact to a topic.
 *
 * @example
 * ```ts
 * subscribeTopic('subscribe-newsletter', {
 *   topicId: 'newsletter',
 *   channel: 'email',
 * })
 * ```
 */
export function subscribeTopic(
  id: string,
  config: Omit<TopicStepConfig, 'type'> & { name?: string }
): StepDefinition {
  const { name, ...topicConfig } = config;
  return {
    id,
    type: 'subscribe_topic',
    name: name ?? `Subscribe to topic: ${config.topicId}`,
    config: { type: 'subscribe_topic', ...topicConfig },
  };
}

/**
 * Unsubscribe a contact from a topic.
 *
 * @example
 * ```ts
 * unsubscribeTopic('unsubscribe-promo', {
 *   topicId: 'promotions',
 *   channel: 'email',
 * })
 * ```
 */
export function unsubscribeTopic(
  id: string,
  config: Omit<TopicStepConfig, 'type'> & { name?: string }
): StepDefinition {
  const { name, ...topicConfig } = config;
  return {
    id,
    type: 'unsubscribe_topic',
    name: name ?? `Unsubscribe from topic: ${config.topicId}`,
    config: { type: 'unsubscribe_topic', ...topicConfig },
  };
}

/**
 * Call an external webhook.
 *
 * @example
 * ```ts
 * webhook('notify-slack', {
 *   url: 'https://hooks.slack.com/services/...',
 *   method: 'POST',
 *   body: { text: 'New user signed up!' },
 * })
 * ```
 */
export function webhook(
  id: string,
  config: Omit<WebhookStepConfig, 'type'> & { name?: string }
): StepDefinition {
  const { name, ...webhookConfig } = config;
  return {
    id,
    type: 'webhook',
    name: name ?? `Webhook: ${config.url}`,
    config: { type: 'webhook', method: 'POST', ...webhookConfig },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a cross-channel cascade that tries channels in order.
 * Stops when engagement is detected on any channel.
 *
 * Returns an array of step definitions that get flattened into the workflow.
 *
 * @example
 * ```ts
 * cascade('notify-user', {
 *   channels: [
 *     {
 *       type: 'email',
 *       template: 'welcome-email',
 *       waitFor: { hours: 2 },
 *       engagement: 'opened',
 *     },
 *     {
 *       type: 'sms',
 *       template: 'welcome-sms',
 *     },
 *   ],
 * })
 * ```
 *
 * Expands to: sendEmail → waitForEmailEngagement → condition (engaged?) → yes: exit → no: sendSms
 */
export function cascade(
  id: string,
  config: CascadeConfig
): StepDefinition[] {
  const { channels } = config;
  const steps: StepDefinition[] = [];

  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i];
    const isLast = i === channels.length - 1;
    const channelId = `${id}-${channel.type}${i > 0 ? `-${i}` : ''}`;

    // 1. Send the message on this channel
    if (channel.type === 'email') {
      steps.push(
        sendEmail(channelId, {
          template: channel.template,
          subject: channel.subject,
          from: channel.from,
          fromName: channel.fromName,
          name: `Cascade: send ${channel.template}`,
        })
      );
    } else {
      steps.push(
        sendSms(channelId, {
          template: channel.template,
          message: channel.message,
          senderId: channel.senderId,
          name: `Cascade: send ${channel.template || 'SMS'}`,
        })
      );
    }

    // 2. If not the last channel, wait for engagement and check
    if (!isLast && channel.waitFor) {
      if (channel.type === 'email') {
        // Wait for email engagement
        const waitId = `${channelId}-wait`;
        steps.push(
          waitForEmailEngagement(waitId, {
            emailStepId: channelId,
            engagementType: channel.engagement ?? 'opened',
            timeout: channel.waitFor,
            name: `Cascade: wait for ${channel.engagement ?? 'opened'}`,
          })
        );

        // Check if engaged → exit cascade, otherwise continue to next channel
        const checkId = `${channelId}-check`;
        steps.push(
          condition(checkId, {
            field: `steps.${waitId}.engaged`,
            operator: 'equals',
            value: true,
            name: `Cascade: ${channel.type} engaged?`,
            branches: {
              yes: [exit(`${id}-engaged`, { reason: `Engaged via ${channel.type}` })],
            },
          })
        );
      } else {
        // For SMS, just delay before trying next channel
        const waitId = `${channelId}-wait`;
        steps.push(
          delay(waitId, {
            ...channel.waitFor,
            name: `Cascade: wait before next channel`,
          })
        );
      }
    }
  }

  return steps;
}
