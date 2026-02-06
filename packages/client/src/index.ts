export type { PlatformClient, WrapsPlatformConfig } from './client';
export { createPlatformClient } from './client';
export type { operations, paths } from './schema.d.ts';

// Project configuration
export {
  defineConfig,
  defineBrand,
  type WrapsProjectConfig,
  type WrapsBrandKit,
  type WrapsEnvironment,
} from './config';

// Workflow definitions
export {
  defineWorkflow,
  type WorkflowDefinition,
  type WorkflowTriggerType,
  type WorkflowStepType,
  type WorkflowSettings,
  type TriggerDefinition,
  type StepDefinition,
  type StepConfig,
  type DurationConfig,
  type ConditionOperator,
  type SendEmailStepConfig,
  type SendSmsStepConfig,
  type DelayStepConfig,
  type DelayStepDbConfig,
  type ConditionStepConfig,
  type WaitForEventStepConfig,
  type WaitForEventStepDbConfig,
  type WaitForEmailEngagementStepConfig,
  type WaitForEmailEngagementStepDbConfig,
  type UpdateContactStepConfig,
  type WebhookStepConfig,
  type TopicStepConfig,
  type ExitStepConfig,
} from './workflow';

export {
  sendEmail,
  sendSms,
  delay,
  condition,
  waitForEvent,
  waitForEmailEngagement,
  exit,
  updateContact,
  subscribeTopic,
  unsubscribeTopic,
  webhook,
} from './workflow-steps';
