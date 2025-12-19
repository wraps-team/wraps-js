import { WrapsSMS } from '@wraps.dev/sms';

// Create SMS client with Vercel OIDC authentication
// This uses AWS AssumeRoleWithWebIdentity under the hood
const sms = new WrapsSMS({
  region: 'us-east-1',
  roleArn: process.env.AWS_ROLE_ARN, // Set by wraps CLI during setup
  roleSessionName: 'wraps-sms-session',
});

// Send SMS from a Vercel serverless function
export async function POST(request: Request) {
  const { to, message } = await request.json();

  try {
    const result = await sms.send({
      to,
      message,
      messageType: 'TRANSACTIONAL',
    });

    return Response.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error('SMS send error:', error);

    return Response.json({ success: false, error: 'Failed to send SMS' }, { status: 500 });
  }
}

// For Next.js Edge Runtime
export const runtime = 'nodejs';
