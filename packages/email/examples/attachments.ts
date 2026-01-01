import { WrapsEmail } from '../src/index';

/**
 * Example: Sending emails with attachments
 *
 * This example demonstrates various ways to send emails with attachments
 * using the Wraps Email SDK.
 */

const email = new WrapsEmail({
  region: 'us-east-1',
  // Credentials will be automatically detected from environment
});

async function main() {
  // Example 1: Single PDF attachment from Buffer
  console.log('Example 1: Single PDF attachment');
  try {
    const result1 = await email.send({
      from: 'you@company.com',
      to: 'recipient@example.com',
      subject: 'Invoice #12345',
      html: `
        <h1>Thank you for your purchase!</h1>
        <p>Please find your invoice attached.</p>
        <p>If you have any questions, feel free to reply to this email.</p>
      `,
      text: 'Thank you for your purchase! Please find your invoice attached.',
      attachments: [
        {
          filename: 'invoice-12345.pdf',
          content: Buffer.from('PDF content here...'), // Replace with actual PDF buffer
          contentType: 'application/pdf',
        },
      ],
    });
    console.log('✓ Email sent with message ID:', result1.messageId);
  } catch (error) {
    console.error('✗ Failed to send:', error);
  }

  // Example 2: Multiple attachments with different file types
  console.log('\nExample 2: Multiple attachments');
  try {
    const result2 = await email.send({
      from: 'you@company.com',
      to: 'recipient@example.com',
      subject: 'Monthly Report - January 2025',
      html: `
        <h1>Monthly Report</h1>
        <p>Please review the attached files:</p>
        <ul>
          <li>Financial Report (PDF)</li>
          <li>Sales Chart (PNG)</li>
          <li>Raw Data (CSV)</li>
        </ul>
      `,
      attachments: [
        {
          filename: 'financial-report.pdf',
          content: Buffer.from('Report content...'),
          contentType: 'application/pdf',
        },
        {
          filename: 'sales-chart.png',
          content: Buffer.from('PNG image data...'),
          contentType: 'image/png',
        },
        {
          filename: 'sales-data.csv',
          content: Buffer.from('Date,Sales\n2025-01-01,1000\n2025-01-02,1500'),
          contentType: 'text/csv',
        },
      ],
    });
    console.log('✓ Email sent with message ID:', result2.messageId);
  } catch (error) {
    console.error('✗ Failed to send:', error);
  }

  // Example 3: Attachment from file system
  console.log('\nExample 3: Attachment from file');
  try {
    // Read file from disk (uncomment and adjust path)
    // const fileBuffer = readFileSync('./path/to/file.pdf');

    const result3 = await email.send({
      from: 'you@company.com',
      to: 'recipient@example.com',
      subject: 'Contract for Review',
      html: '<p>Please review and sign the attached contract.</p>',
      attachments: [
        {
          filename: 'contract.pdf',
          content: Buffer.from('Contract PDF...'), // Replace with fileBuffer
          contentType: 'application/pdf',
        },
      ],
    });
    console.log('✓ Email sent with message ID:', result3.messageId);
  } catch (error) {
    console.error('✗ Failed to send:', error);
  }

  // Example 4: Base64 encoded attachment
  console.log('\nExample 4: Base64 attachment');
  try {
    // Base64 encoded content
    const base64Content = Buffer.from('Hello, World!').toString('base64');

    const result4 = await email.send({
      from: 'you@company.com',
      to: 'recipient@example.com',
      subject: 'Document',
      html: '<p>Document attached as base64.</p>',
      attachments: [
        {
          filename: 'document.txt',
          content: base64Content, // Can be base64 string
          contentType: 'text/plain',
        },
      ],
    });
    console.log('✓ Email sent with message ID:', result4.messageId);
  } catch (error) {
    console.error('✗ Failed to send:', error);
  }

  // Example 5: Attachment with auto-detected MIME type
  console.log('\nExample 5: Auto-detected MIME type');
  try {
    const result5 = await email.send({
      from: 'you@company.com',
      to: 'recipient@example.com',
      subject: 'Files Attached',
      html: '<p>Various files attached - MIME types auto-detected.</p>',
      attachments: [
        {
          filename: 'report.pdf',
          content: Buffer.from('PDF...'),
          // contentType omitted - will be detected as 'application/pdf'
        },
        {
          filename: 'photo.jpg',
          content: Buffer.from('JPEG...'),
          // contentType omitted - will be detected as 'image/jpeg'
        },
        {
          filename: 'data.json',
          content: Buffer.from('{"key": "value"}'),
          // contentType omitted - will be detected as 'application/json'
        },
      ],
    });
    console.log('✓ Email sent with message ID:', result5.messageId);
  } catch (error) {
    console.error('✗ Failed to send:', error);
  }

  // Example 6: Attachment with CC/BCC and tags
  console.log('\nExample 6: Attachment with advanced options');
  try {
    const result6 = await email.send({
      from: 'you@company.com',
      to: 'primary@example.com',
      cc: ['manager@company.com'],
      bcc: ['archive@company.com'],
      replyTo: 'support@company.com',
      subject: 'Quarterly Report Q1 2025',
      html: '<h1>Quarterly Report</h1><p>See attached report.</p>',
      attachments: [
        {
          filename: 'q1-2025-report.pdf',
          content: Buffer.from('Report...'),
          contentType: 'application/pdf',
        },
      ],
      tags: {
        campaign: 'quarterly-reports',
        quarter: 'Q1-2025',
      },
      configurationSetName: 'reports-config-set',
    });
    console.log('✓ Email sent with message ID:', result6.messageId);
  } catch (error) {
    console.error('✗ Failed to send:', error);
  }

  // Clean up
  email.destroy();
  console.log('\n✓ Email client destroyed');
}

// Run examples
main().catch(console.error);
