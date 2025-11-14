import { fromWebToken } from '@aws-sdk/credential-providers';
import { WrapsEmail } from '@wraps.dev/email';

async function main() {
  // Example 1: Using Vercel OIDC with credential provider
  const credentials = fromWebToken({
    roleArn: process.env.AWS_ROLE_ARN || 'arn:aws:iam::123456789012:role/MyVercelRole',
    webIdentityToken: async () => {
      // Vercel automatically provides OIDC token via environment variable
      return process.env.VERCEL_OIDC_TOKEN || '';
    },
    roleSessionName: 'vercel-email-session',
  });

  const email = new WrapsEmail({
    region: 'us-east-1',
    credentials, // Pass the credential provider directly
  });

  // Send email using OIDC credentials
  const result = await email.send({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Email from Vercel via OIDC',
    html: '<h1>Hello from Vercel!</h1><p>This email was sent using OIDC federation.</p>',
  });

  console.log('Email sent successfully using Vercel OIDC!');
  console.log('Message ID:', result.messageId);

  // Example 2: Alternative approach using roleArn parameter
  // This uses the built-in OIDC support via AWS_WEB_IDENTITY_TOKEN_FILE
  const emailWithRole = new WrapsEmail({
    region: 'us-east-1',
    roleArn: process.env.AWS_ROLE_ARN || 'arn:aws:iam::123456789012:role/MyVercelRole',
    roleSessionName: 'vercel-email-session',
  });

  const result2 = await emailWithRole.send({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Email via roleArn',
    html: '<h1>Alternative approach</h1><p>Using roleArn parameter.</p>',
  });

  console.log('Email sent successfully using roleArn!');
  console.log('Message ID:', result2.messageId);
}

main().catch(console.error);
