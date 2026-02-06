export type { PlatformClient, WrapsPlatformConfig } from './client';
export { createPlatformClient } from './client';
// Project configuration
export {
  defineBrand,
  defineConfig,
  type WrapsBrandKit,
  type WrapsEnvironment,
  type WrapsProjectConfig,
} from './config';
export type { operations, paths } from './schema.d.ts';

// Workflow definitions
export {
  type ConditionOperator,
  type ConditionStepConfig,
  type DelayStepConfig,
  type DelayStepDbConfig,
  type DurationConfig,
  defineWorkflow,
  type ExitStepConfig,
  type SendEmailStepConfig,
  type SendSmsStepConfig,
  type StepConfig,
  type StepDefinition,
  type TopicStepConfig,
  type TriggerDefinition,
  type UpdateContactStepConfig,
  type WaitForEmailEngagementStepConfig,
  type WaitForEmailEngagementStepDbConfig,
  type WaitForEventStepConfig,
  type WaitForEventStepDbConfig,
  type WebhookStepConfig,
  type WorkflowDefinition,
  type WorkflowSettings,
  type WorkflowStepType,
  type WorkflowTriggerType,
} from './workflow';

export {
  condition,
  delay,
  exit,
  sendEmail,
  sendSms,
  subscribeTopic,
  unsubscribeTopic,
  updateContact,
  waitForEmailEngagement,
  waitForEvent,
  webhook,
} from './workflow-steps';
