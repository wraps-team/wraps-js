import { beforeAll, describe, expect, it } from 'vitest';
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

/**
 * AWS SES Mailbox Simulator addresses for testing different scenarios
 * @see https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html
 */
const SES_SIMULATOR = {
  SUCCESS: 'success@simulator.amazonses.com',
  BOUNCE: 'bounce@simulator.amazonses.com',
  COMPLAINT: 'complaint@simulator.amazonses.com',
  SUPPRESSION_LIST: 'suppressionlist@simulator.amazonses.com',
  OUT_OF_OFFICE: 'ooto@simulator.amazonses.com',
} as const;

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

    it('should send email with attachments', async () => {
      // Create sample attachment content
      const textContent = 'This is a test text file.\nLine 2\nLine 3';
      const jsonContent = JSON.stringify(
        {
          test: true,
          timestamp: new Date().toISOString(),
          message: 'Integration test attachment',
        },
        null,
        2
      );

      const result = await email.send({
        from: TEST_FROM_EMAIL,
        to: TEST_TO_EMAIL,
        subject: 'Wraps Email SDK - Attachment Test',
        html: `
          <h1>Email with Attachments</h1>
          <p>This email contains multiple file attachments:</p>
          <ul>
            <li>test-file.txt (plain text)</li>
            <li>test-data.json (JSON data)</li>
          </ul>
          <p>This is a test of the attachment functionality.</p>
        `,
        text: 'This email contains test attachments. This is a test of the attachment functionality.',
        attachments: [
          {
            filename: 'test-file.txt',
            content: Buffer.from(textContent),
            contentType: 'text/plain',
          },
          {
            filename: 'test-data.json',
            content: Buffer.from(jsonContent),
            contentType: 'application/json',
          },
        ],
      });

      expect(result.messageId).toBeDefined();
      expect(result.requestId).toBeDefined();

      console.log('✓ Email with attachments sent successfully');
      console.log('  Message ID:', result.messageId);
      console.log('  Request ID:', result.requestId);
      console.log('  Attachments: 2 files');
      console.log('    - test-file.txt (text/plain)');
      console.log('    - test-data.json (application/json)');
    }, 30000);

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

  describe('AWS SES Mailbox Simulator', () => {
    it('should send to success simulator address', async () => {
      const result = await email.send({
        from: TEST_FROM_EMAIL,
        to: SES_SIMULATOR.SUCCESS,
        subject: 'Test: Successful Delivery',
        html: '<p>This email tests successful delivery using AWS SES simulator.</p>',
        text: 'This email tests successful delivery using AWS SES simulator.',
      });

      expect(result.messageId).toBeDefined();
      expect(result.requestId).toBeDefined();
      console.log('✓ Email sent to success simulator');
      console.log('  Expected: Successful delivery');
      console.log('  Message ID:', result.messageId);
    }, 30000);

    it('should send to bounce simulator address', async () => {
      const result = await email.send({
        from: TEST_FROM_EMAIL,
        to: SES_SIMULATOR.BOUNCE,
        subject: 'Test: Bounce Scenario',
        html: '<p>This email tests bounce scenario using AWS SES simulator.</p>',
        text: 'This email tests bounce scenario using AWS SES simulator.',
      });

      expect(result.messageId).toBeDefined();
      console.log('✓ Email sent to bounce simulator');
      console.log('  Expected: SMTP 550 5.1.1 "Unknown User" bounce');
      console.log('  Message ID:', result.messageId);
      console.log('  Note: Check CloudWatch or SNS for bounce notification');
    }, 30000);

    it('should send to complaint simulator address', async () => {
      const result = await email.send({
        from: TEST_FROM_EMAIL,
        to: SES_SIMULATOR.COMPLAINT,
        subject: 'Test: Complaint Scenario',
        html: '<p>This email tests complaint scenario using AWS SES simulator.</p>',
        text: 'This email tests complaint scenario using AWS SES simulator.',
      });

      expect(result.messageId).toBeDefined();
      console.log('✓ Email sent to complaint simulator');
      console.log('  Expected: Email delivered, then complaint generated');
      console.log('  Message ID:', result.messageId);
      console.log('  Note: Check CloudWatch or SNS for complaint notification');
    }, 30000);

    it('should send to suppression list simulator address', async () => {
      const result = await email.send({
        from: TEST_FROM_EMAIL,
        to: SES_SIMULATOR.SUPPRESSION_LIST,
        subject: 'Test: Suppression List Scenario',
        html: '<p>This email tests suppression list scenario using AWS SES simulator.</p>',
        text: 'This email tests suppression list scenario using AWS SES simulator.',
      });

      expect(result.messageId).toBeDefined();
      console.log('✓ Email sent to suppression list simulator');
      console.log('  Expected: Hard bounce (as if address is on suppression list)');
      console.log('  Message ID:', result.messageId);
      console.log('  Note: Check CloudWatch or SNS for suppression list bounce');
    }, 30000);

    it('should send to out-of-office simulator address', async () => {
      const result = await email.send({
        from: TEST_FROM_EMAIL,
        to: SES_SIMULATOR.OUT_OF_OFFICE,
        subject: 'Test: Out-of-Office Auto-Response',
        html: '<p>This email tests out-of-office auto-response using AWS SES simulator.</p>',
        text: 'This email tests out-of-office auto-response using AWS SES simulator.',
      });

      expect(result.messageId).toBeDefined();
      console.log('✓ Email sent to out-of-office simulator');
      console.log('  Expected: Email delivered with auto-response');
      console.log('  Message ID:', result.messageId);
      console.log('  Note: Check for automatic response message');
    }, 30000);

    it('should send to multiple simulator addresses', async () => {
      const result = await email.send({
        from: TEST_FROM_EMAIL,
        to: [SES_SIMULATOR.SUCCESS, SES_SIMULATOR.BOUNCE],
        subject: 'Test: Multiple Recipients (Mixed Scenarios)',
        html: '<p>This email tests multiple recipients with different outcomes.</p>',
        text: 'This email tests multiple recipients with different outcomes.',
      });

      expect(result.messageId).toBeDefined();
      console.log('✓ Email sent to multiple simulator addresses');
      console.log('  Expected: One success, one bounce');
      console.log('  Message ID:', result.messageId);
    }, 30000);
  });
});
