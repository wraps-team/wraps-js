import { WrapsEmail } from '@wraps.dev/email';

async function main() {
  // Initialize client (credentials auto-detected from environment)
  const email = new WrapsEmail({
    region: 'us-east-1', // optional, defaults to us-east-1
  });

  // Send simple email
  const result = await email.send({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Hello from Wraps Email!',
    html: '<h1>Welcome</h1><p>This is a test email.</p>',
    text: 'Welcome! This is a test email.',
  });

  console.log('Email sent successfully!');
  console.log('Message ID:', result.messageId);
  console.log('Request ID:', result.requestId);
}

main().catch(console.error);
