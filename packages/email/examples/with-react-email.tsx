import { WrapsEmail } from '@wraps.dev/email';
import * as React from 'react';

// Example React.email component
function WelcomeEmail({ name, confirmUrl }: { name: string; confirmUrl: string }) {
  return (
    <div>
      <h1>Welcome {name}!</h1>
      <p>Thanks for signing up. Please confirm your email address:</p>
      <a href={confirmUrl}>Confirm Email</a>
    </div>
  );
}

async function main() {
  const email = new WrapsEmail({
    region: 'us-east-1',
  });

  // Send with React.email template
  const result = await email.send({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Welcome to our platform',
    react: <WelcomeEmail name="John Doe" confirmUrl="https://example.com/confirm/abc123" />,
  });

  console.log('Email sent with React template!');
  console.log('Message ID:', result.messageId);
}

main().catch(console.error);
