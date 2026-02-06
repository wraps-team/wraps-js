/**
 * Workflow Definition Types
 *
 * Declarative TypeScript workflow definitions for email automation.
 * Use `defineWorkflow()` in `wraps/workflows/*.ts` for full TypeScript intellisense.
 *
 * @example
 * ```ts
 * import { defineWorkflow, sendEmail, delay, condition, exit } from '@wraps.dev/client';
 *
 * export default defineWorkflow({
 *   name: 'User Onboarding',
 *   description: 'Welcome sequence for new users',
 *
 *   trigger: { type: 'contact_created' },
 *
 *   steps: [
 *     sendEmail('welcome', { template: 'welcome' }),
 *     delay('wait-1-day', { days: 1 }),
 *     condition('check-activation', {
 *       field: 'contact.hasActivated',
 *       operator: 'equals',
 *       value: true,
 *       branches: {
 *         yes: [exit('activated')],
 *         no: [sendEmail('tips', { template: 'getting-started-tips' })],
 *       },
 *     }),
 *   ],
 * });
 * ```
 */

// ═══════════════════════════════════════════════════════════════════════════
// TRIGGER TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trigger types for workflow entry points
 */
export type WorkflowTriggerType =
  | 'event'
  | 'contact_created'
  | 'contact_updated'
  | 'segment_entry'
  | 'segment_exit'
  | 'schedule'
  | 'api'
  | 'topic_subscribed'
  | 'topic_unsubscribed';

/**
 * Trigger configuration based on trigger type
 */
export interface TriggerDefinition {
  /** The type of trigger that starts this workflow */
  type: WorkflowTriggerType;

  /** For 'event' trigger: the event name to listen for */
  eventName?: string;

  /** For segment triggers: the segment ID to monitor */
  segmentId?: string;

  /** For 'schedule' trigger: cron expression */
  schedule?: string;

  /** For 'schedule' trigger: timezone (e.g., 'America/New_York') */
  timezone?: string;

  /** For topic triggers: the topic ID to monitor */
  topicId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Workflow step types available in the builder
 */
export type WorkflowStepType =
  | 'trigger'
  | 'send_email'
  | 'send_sms'
  | 'delay'
  | 'exit'
  | 'condition'
  | 'webhook'
  | 'update_contact'
  | 'wait_for_event'
  | 'wait_for_email_engagement'
  | 'subscribe_topic'
  | 'unsubscribe_topic';

/**
 * Duration configuration for delays and timeouts
 */
export interface DurationConfig {
  /** Number of days */
  days?: number;
  /** Number of hours */
  hours?: number;
  /** Number of minutes */
  minutes?: number;
}

/**
 * Condition operators for branching
 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equals'
  | 'less_than_or_equals'
  | 'is_set'
  | 'is_not_set'
  | 'is_true'
  | 'is_false';

/**
 * Email template reference (by slug) or inline content
 */
export type EmailContent =
  | { template: string }
  | { subject: string; body: string };

/**
 * SMS template reference or inline message
 */
export type SmsContent = { template: string } | { message: string };

/**
 * Configuration for send_email step
 */
export interface SendEmailStepConfig {
  /** Template slug or inline content */
  template?: string;
  subject?: string;
  body?: string;
  /** Override sender address */
  from?: string;
  /** Override sender name */
  fromName?: string;
  /** Override reply-to address */
  replyTo?: string;
}

/**
 * Configuration for send_sms step
 */
export interface SendSmsStepConfig {
  /** Template slug or inline message */
  template?: string;
  message?: string;
  /** Override sender ID */
  senderId?: string;
}

/**
 * Configuration for delay step (user-facing)
 */
export interface DelayStepConfig extends DurationConfig {}

/**
 * Configuration for delay step (internal/DB format)
 */
export interface DelayStepDbConfig {
  /** Delay amount */
  amount: number;
  /** Delay unit */
  unit: 'minutes' | 'hours' | 'days' | 'weeks';
}

/**
 * Configuration for condition step
 */
export interface ConditionStepConfig {
  /** Field to evaluate (e.g., 'contact.email', 'contact.hasActivated') */
  field: string;
  /** Comparison operator */
  operator: ConditionOperator;
  /** Value to compare against (not used for is_set, is_not_set, is_true, is_false) */
  value?: unknown;
  /** Branches for yes/no outcomes */
  branches: {
    yes?: StepDefinition[];
    no?: StepDefinition[];
  };
}

/**
 * Configuration for wait_for_event step (user-facing)
 */
export interface WaitForEventStepConfig {
  /** Event name to wait for */
  eventName: string;
  /** Timeout duration (optional) - will be converted to timeoutSeconds */
  timeout?: DurationConfig;
}

/**
 * Configuration for wait_for_event step (internal/DB format)
 */
export interface WaitForEventStepDbConfig {
  /** Event name to wait for */
  eventName: string;
  /** Timeout in seconds */
  timeoutSeconds?: number;
}

/**
 * Configuration for wait_for_email_engagement step (user-facing)
 */
export interface WaitForEmailEngagementStepConfig {
  /** ID of the email step to track */
  emailStepId: string;
  /** Type of engagement to wait for */
  engagementType: 'opened' | 'clicked';
  /** Timeout duration (optional) - will be converted to timeoutSeconds */
  timeout?: DurationConfig;
}

/**
 * Configuration for wait_for_email_engagement step (internal/DB format)
 */
export interface WaitForEmailEngagementStepDbConfig {
  /** Timeout in seconds */
  timeoutSeconds?: number;
}

/**
 * Configuration for update_contact step
 */
export interface UpdateContactStepConfig {
  /** Field updates to apply */
  updates: Array<{
    field: string;
    operation: 'set' | 'increment' | 'decrement' | 'append' | 'remove';
    value?: unknown;
  }>;
}

/**
 * Configuration for webhook step
 */
export interface WebhookStepConfig {
  /** Webhook URL */
  url: string;
  /** HTTP method (default: POST) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** HTTP headers */
  headers?: Record<string, string>;
  /** Request body (for POST/PUT/PATCH) */
  body?: Record<string, unknown>;
}

/**
 * Configuration for subscribe/unsubscribe_topic step
 */
export interface TopicStepConfig {
  /** Topic ID to subscribe to or unsubscribe from */
  topicId: string;
  /** Channel for the subscription */
  channel?: 'email' | 'sms';
}

/**
 * Configuration for exit step
 */
export interface ExitStepConfig {
  /** Optional reason for exiting */
  reason?: string;
  /** Mark execution as completed, cancelled, or failed */
  markAs?: 'completed' | 'cancelled' | 'failed';
}

/**
 * A step in the workflow definition
 */
export interface StepDefinition {
  /** Unique step identifier (used for transitions and references) */
  id: string;
  /** Step type */
  type: WorkflowStepType;
  /** Optional display name (defaults to type if not provided) */
  name?: string;
  /** Step-specific configuration */
  config: StepConfig;
  /** Branches for condition steps */
  branches?: {
    yes?: StepDefinition[];
    no?: StepDefinition[];
  };
}

/**
 * Union of all step configurations (internal/DB format)
 * This is the format stored in the database and used by the execution engine.
 */
export type StepConfig =
  | ({ type: 'send_email' } & SendEmailStepConfig)
  | ({ type: 'send_sms' } & SendSmsStepConfig)
  | ({ type: 'delay' } & DelayStepDbConfig)
  | ({ type: 'condition' } & Omit<ConditionStepConfig, 'branches'>)
  | ({ type: 'wait_for_event' } & WaitForEventStepDbConfig)
  | ({ type: 'wait_for_email_engagement' } & WaitForEmailEngagementStepDbConfig)
  | ({ type: 'update_contact' } & UpdateContactStepConfig)
  | ({ type: 'webhook' } & WebhookStepConfig)
  | ({ type: 'subscribe_topic' } & TopicStepConfig)
  | ({ type: 'unsubscribe_topic' } & TopicStepConfig)
  | ({ type: 'exit' } & ExitStepConfig);

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Workflow execution settings
 */
export interface WorkflowSettings {
  /** Allow the same contact to re-enter the workflow if they trigger it again */
  allowReentry?: boolean;

  /** Minimum seconds between re-entries for the same contact (only used if allowReentry is true) */
  reentryDelaySeconds?: number;

  /** Maximum concurrent executions allowed for this workflow */
  maxConcurrentExecutions?: number;

  /** Cooldown period in seconds before a contact can trigger this workflow again */
  contactCooldownSeconds?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Complete workflow definition
 */
export interface WorkflowDefinition {
  /** Display name for the workflow */
  name: string;

  /** Optional description */
  description?: string;

  /** What triggers this workflow */
  trigger: TriggerDefinition;

  /** Steps in the workflow (executed sequentially unless branched) */
  steps: StepDefinition[];

  /** Execution settings */
  settings?: WorkflowSettings;

  /** Optional: associate workflow with a topic for subscription checks */
  topicId?: string;

  /** Default sender settings (can be overridden per step) */
  defaults?: {
    from?: string;
    fromName?: string;
    replyTo?: string;
    senderId?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFINE WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Define an email automation workflow.
 * Use this in `wraps/workflows/*.ts` for full TypeScript intellisense.
 *
 * @example
 * ```ts
 * import { defineWorkflow, sendEmail, delay, exit } from '@wraps.dev/client';
 *
 * export default defineWorkflow({
 *   name: 'Welcome Sequence',
 *   trigger: { type: 'contact_created' },
 *   steps: [
 *     sendEmail('welcome', { template: 'welcome' }),
 *     delay('wait-1-day', { days: 1 }),
 *     sendEmail('tips', { template: 'getting-started-tips' }),
 *   ],
 * });
 * ```
 */
export function defineWorkflow(
  definition: WorkflowDefinition
): WorkflowDefinition {
  return definition;
}
