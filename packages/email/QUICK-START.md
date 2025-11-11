# Quick Start Guide

Get up and running with @wraps-js/email in minutes.

## Installation

```bash
pnpm add @wraps-js/email
```

## Setup

### 1. Configure AWS Credentials

**Option A: Environment Variables**
```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1
```

**Option B: AWS Credentials File**
```bash
# ~/.aws/credentials
[default]
aws_access_key_id = your_access_key
aws_secret_access_key = your_secret_key
```

### 2. Verify Email Addresses (Sandbox Mode)

If you're in AWS SES sandbox mode, verify your email addresses:

1. Go to [AWS SES Console](https://console.aws.amazon.com/ses/)
2. Click **Verified identities** → **Create identity**
3. Enter your email address
4. Check your inbox and click the verification link
5. Repeat for both sender and recipient emails

## Basic Usage

```typescript
import { WrapsEmail } from '@wraps-js/email';

// Initialize client
const email = new WrapsEmail({
  region: 'us-east-1', // optional, defaults to us-east-1
});

// Send your first email
const result = await email.send({
  from: 'sender@example.com',
  to: 'recipient@example.com',
  subject: 'Hello from Wraps Email!',
  html: '<h1>Welcome!</h1><p>This is your first email.</p>',
  text: 'Welcome! This is your first email.',
});

console.log('Email sent!', result.messageId);
```

## Common Recipes

### Send to Multiple Recipients

```typescript
await email.send({
  from: 'sender@example.com',
  to: ['user1@example.com', 'user2@example.com'],
  cc: ['manager@example.com'],
  subject: 'Team Update',
  html: '<p>Important announcement</p>',
});
```

### Send with React Component

```typescript
import { EmailTemplate } from './emails/Welcome';

await email.send({
  from: 'sender@example.com',
  to: 'user@example.com',
  subject: 'Welcome!',
  react: <EmailTemplate name="John" />,
});
```

### Use SES Template

```typescript
// Create template once
await email.templates.create({
  name: 'welcome',
  subject: 'Welcome {{name}}!',
  html: '<h1>Hello {{name}}!</h1>',
});

// Send using template
await email.sendTemplate({
  from: 'sender@example.com',
  to: 'user@example.com',
  template: 'welcome',
  templateData: { name: 'John' },
});
```

### Bulk Send

```typescript
await email.sendBulkTemplate({
  from: 'sender@example.com',
  template: 'newsletter',
  destinations: [
    { to: 'user1@example.com', templateData: { name: 'Alice' } },
    { to: 'user2@example.com', templateData: { name: 'Bob' } },
  ],
});
```

## Error Handling

```typescript
import { ValidationError, SESError } from '@wraps-js/email';

try {
  await email.send({ ... });
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Invalid params:', error.message);
  } else if (error instanceof SESError) {
    console.error('SES error:', error.code);
  }
}
```

## Troubleshooting

### "Email address not verified"
→ Verify both sender and recipient in SES Console (sandbox mode)

### "Access denied"
→ Check your AWS credentials have SES permissions

### "Module not found: @react-email/components"
→ Install peer dependency: `pnpm add @react-email/components react`

## Next Steps

- **Full Documentation:** See [README.md](./README.md)
- **Testing Guide:** See [TESTING.md](./TESTING.md)
- **Examples:** Check the [examples/](./examples/) directory
- **API Reference:** See [README.md#api-reference](./README.md#api-reference)

## Need Help?

- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [Report Issues](https://github.com/wraps-team/wraps-js/issues)
- [Request Production Access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)

---

**Happy emailing! 📧**
