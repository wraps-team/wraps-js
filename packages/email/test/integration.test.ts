import { describe, it, expect, beforeAll } from 'vitest';
import { WrapsEmail } from '../src/client';

/**
 * Integration tests for Wraps Email SDK
 *
 * These tests require actual AWS SES credentials and should be run manually.
 * To run: INTEGRATION_TEST=true vitest run test/integration.test.ts
 *
 * Prerequisites:
 * 1. AWS credentials configured (env vars or ~/.aws/credentials)
 * 2. SES sandbox mode with verified email addresses
 * 3. Set TEST_FROM_EMAIL and TEST_TO_EMAIL environment variables
 */

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const TEST_FROM_EMAIL = process.env.TEST_FROM_EMAIL || 'sender@example.com';
const TEST_TO_EMAIL = process.env.TEST_TO_EMAIL || 'recipient@example.com';

describe.skipIf(SKIP_INTEGRATION)('Integration Tests', () => {
  let email: WrapsEmail;

  beforeAll(() => {
    email = new WrapsEmail({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  });

  describe('send', () => {
    it('should send a simple HTML email', async () => {
      const result = await email.send({
        from: TEST_FROM_EMAIL,
        to: TEST_TO_EMAIL,
        subject: 'Wraps Email SDK - Integration Test',
        html: '<h1>Hello from Wraps Email!</h1><p>This is an integration test.</p>',
        text: 'Hello from Wraps Email! This is an integration test.',
      });

      expect(result.messageId).toBeDefined();
      expect(result.requestId).toBeDefined();
      expect(typeof result.messageId).toBe('string');
      expect(result.messageId.length).toBeGreaterThan(0);

      console.log('✓ Email sent successfully');
      console.log('  Message ID:', result.messageId);
      console.log('  Request ID:', result.requestId);
    }, 30000); // 30 second timeout

    it('should send email with CC and BCC', async () => {
      const result = await email.send({
        from: TEST_FROM_EMAIL,
        to: TEST_TO_EMAIL,
        cc: TEST_FROM_EMAIL, // Send CC to ourselves
        subject: 'Wraps Email SDK - CC/BCC Test',
        html: '<p>Testing CC and BCC functionality</p>',
      });

      expect(result.messageId).toBeDefined();
      console.log('✓ Email with CC sent successfully');
    }, 30000);

    it('should send email with tags', async () => {
      const result = await email.send({
        from: TEST_FROM_EMAIL,
        to: TEST_TO_EMAIL,
        subject: 'Wraps Email SDK - Tags Test',
        html: '<p>Testing email tags</p>',
        tags: {
          environment: 'test',
          type: 'integration-test',
        },
      });

      expect(result.messageId).toBeDefined();
      console.log('✓ Email with tags sent successfully');
    }, 30000);
  });

  describe('templates', () => {
    const TEST_TEMPLATE_NAME = `test-template-${Date.now()}`;

    it('should create a template', async () => {
      await email.templates.create({
        name: TEST_TEMPLATE_NAME,
        subject: 'Welcome {{name}}!',
        html: '<h1>Hello {{name}}!</h1><p>Welcome to our platform.</p>',
        text: 'Hello {{name}}! Welcome to our platform.',
      });

      console.log('✓ Template created:', TEST_TEMPLATE_NAME);
    }, 30000);

    it('should list templates', async () => {
      const templates = await email.templates.list();

      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);

      const ourTemplate = templates.find((t) => t.name === TEST_TEMPLATE_NAME);
      expect(ourTemplate).toBeDefined();

      console.log('✓ Templates listed:', templates.length, 'templates found');
    }, 30000);

    it('should get template details', async () => {
      const template = await email.templates.get(TEST_TEMPLATE_NAME);

      expect(template.name).toBe(TEST_TEMPLATE_NAME);
      expect(template.subject).toBe('Welcome {{name}}!');

      console.log('✓ Template retrieved:', template.name);
    }, 30000);

    it('should send email using template', async () => {
      const result = await email.sendTemplate({
        from: TEST_FROM_EMAIL,
        to: TEST_TO_EMAIL,
        template: TEST_TEMPLATE_NAME,
        templateData: {
          name: 'Test User',
        },
      });

      expect(result.messageId).toBeDefined();
      console.log('✓ Template email sent:', result.messageId);
    }, 30000);

    it('should update template', async () => {
      await email.templates.update({
        name: TEST_TEMPLATE_NAME,
        subject: 'Welcome aboard, {{name}}!',
        html: '<h1>Welcome aboard {{name}}!</h1><p>We are glad to have you.</p>',
        text: 'Welcome aboard {{name}}! We are glad to have you.',
      });

      const template = await email.templates.get(TEST_TEMPLATE_NAME);
      expect(template.subject).toBe('Welcome aboard, {{name}}!');

      console.log('✓ Template updated');
    }, 30000);

    it('should delete template', async () => {
      await email.templates.delete(TEST_TEMPLATE_NAME);

      console.log('✓ Template deleted:', TEST_TEMPLATE_NAME);
    }, 30000);
  });
});
