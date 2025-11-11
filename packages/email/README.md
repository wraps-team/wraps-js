# @wraps-js/email

Beautiful email SDK for AWS SES with React.email support.

## Features

- Resend-like developer experience but calls your SES directly (BYOC model)
- Full TypeScript support with comprehensive types
- React.email integration for beautiful templates
- Automatic AWS credential chain resolution
- Template management (create, update, delete, list)
- Bulk email sending (up to 50 recipients)
- Zero vendor lock-in - just a thin wrapper around AWS SES
- **Dual CJS + ESM builds** - works with any bundler or Node.js

## Installation

```bash
pnpm add @wraps-js/email
```

## Quick Start

```typescript
import { WrapsEmail } from '@wraps-js/email';

const email = new WrapsEmail({ region: 'us-east-1' });

await email.send({
  from: 'you@company.com',
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello World</h1>',
});
```

## Module Format Support

This package supports both CommonJS and ES Modules:

**ESM (modern):**
```typescript
import { WrapsEmail } from '@wraps-js/email';
```

**CommonJS (Node.js):**
```javascript
const { WrapsEmail } = require('@wraps-js/email');
```

## Authentication

Wraps Email uses the AWS credential chain in the following order:

1. Explicit credentials passed to constructor
2. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
3. Shared credentials file (`~/.aws/credentials`)
4. IAM role (EC2, ECS, Lambda)

### With explicit credentials

```typescript
const email = new WrapsEmail({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN, // optional
  },
  region: 'us-west-2',
});
```

### Using environment variables

```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1
```

```typescript
const email = new WrapsEmail(); // Credentials auto-detected
```

## Usage Examples

### Send simple email

```typescript
const result = await email.send({
  from: 'you@company.com',
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello World</h1>',
  text: 'Hello World', // optional
});

console.log('Message ID:', result.messageId);
```

### Send to multiple recipients

```typescript
await email.send({
  from: 'you@company.com',
  to: ['user1@example.com', 'user2@example.com'],
  cc: ['manager@company.com'],
  bcc: ['archive@company.com'],
  subject: 'Team Update',
  html: '<p>Important announcement</p>',
});
```

### React.email Support

```typescript
import { EmailTemplate } from './emails/Welcome';

await email.send({
  from: 'you@company.com',
  to: 'user@example.com',
  subject: 'Welcome to our platform',
  react: <EmailTemplate name="John" orderId="12345" />,
});
```

### Send with attachments

```typescript
const result = await email.send({
  from: 'you@company.com',
  to: 'user@example.com',
  subject: 'Your invoice',
  html: '<p>Invoice attached</p>',
  attachments: [
    {
      filename: 'invoice.pdf',
      content: Buffer.from('...'), // or 'base64-string'
      contentType: 'application/pdf',
    },
  ],
});
```

### Send with tags (for SES tracking)

```typescript
await email.send({
  from: 'you@company.com',
  to: 'user@example.com',
  subject: 'Newsletter',
  html: '<p>Content</p>',
  tags: {
    campaign: 'newsletter-2025-01',
    type: 'marketing',
  },
});
```

## Template Management

SES templates allow you to store reusable email designs with variables in your AWS account.

### Create a template

```typescript
await email.templates.create({
  name: 'welcome-email',
  subject: 'Welcome to {{companyName}}, {{name}}!',
  html: `
    <h1>Welcome {{name}}!</h1>
    <p>Click to confirm: <a href="{{confirmUrl}}">Confirm Account</a></p>
  `,
  text: 'Welcome {{name}}! Click to confirm: {{confirmUrl}}',
});
```

### Create template from React.email component

```typescript
await email.templates.createFromReact({
  name: 'welcome-email-v2',
  subject: 'Welcome to {{companyName}}, {{name}}!',
  react: <WelcomeEmailTemplate />,
  // React component should use {{variable}} syntax for SES placeholders
});
```

### Send using a template

```typescript
const result = await email.sendTemplate({
  from: 'you@company.com',
  to: 'user@example.com',
  template: 'welcome-email',
  templateData: {
    name: 'John',
    companyName: 'Acme Corp',
    confirmUrl: 'https://app.com/confirm/abc123',
  },
});
```

### Bulk send with template (up to 50 recipients)

```typescript
const results = await email.sendBulkTemplate({
  from: 'you@company.com',
  template: 'weekly-digest',
  destinations: [
    {
      to: 'user1@example.com',
      templateData: { name: 'Alice', unreadCount: 5 },
    },
    {
      to: 'user2@example.com',
      templateData: { name: 'Bob', unreadCount: 12 },
    },
  ],
});
```

### Update a template

```typescript
await email.templates.update({
  name: 'welcome-email',
  subject: 'Welcome aboard, {{name}}!',
  html: '<h1>Welcome {{name}}!</h1>...',
});
```

### Get template details

```typescript
const template = await email.templates.get('welcome-email');
console.log(template.name, template.subject);
```

### List all templates

```typescript
const templates = await email.templates.list();
templates.forEach(t => console.log(t.name, t.createdTimestamp));
```

### Delete a template

```typescript
await email.templates.delete('welcome-email');
```

## Error Handling

```typescript
import { WrapsEmailError, ValidationError, SESError } from '@wraps-js/email';

try {
  await email.send({ ... });
} catch (error) {
  if (error instanceof ValidationError) {
    // Invalid email address, missing required fields, etc.
    console.error('Validation error:', error.message);
    console.error('Field:', error.field);
  } else if (error instanceof SESError) {
    // AWS SES error (rate limit, unverified sender, etc.)
    console.error('SES error:', error.message);
    console.error('Code:', error.code); // 'MessageRejected', 'Throttling', etc.
    console.error('Request ID:', error.requestId);
    console.error('Retryable:', error.retryable);
  } else {
    // Other errors (network, auth, etc.)
    console.error('Unknown error:', error);
  }
}
```

## Configuration Options

```typescript
interface WrapsEmailConfig {
  region?: string; // AWS region (defaults to us-east-1)
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  endpoint?: string; // Custom SES endpoint (for testing with LocalStack)
}
```

## Testing with LocalStack

```typescript
const email = new WrapsEmail({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
});
```

## API Reference

### `WrapsEmail`

Main client class for sending emails via AWS SES.

#### Methods

- `send(params: SendEmailParams): Promise<SendEmailResult>` - Send an email
- `sendTemplate(params: SendTemplateParams): Promise<SendEmailResult>` - Send using SES template
- `sendBulkTemplate(params: SendBulkTemplateParams): Promise<SendBulkTemplateResult>` - Bulk send with template
- `templates.create(params: CreateTemplateParams): Promise<void>` - Create SES template
- `templates.createFromReact(params: CreateTemplateFromReactParams): Promise<void>` - Create template from React
- `templates.update(params: UpdateTemplateParams): Promise<void>` - Update template
- `templates.get(name: string): Promise<Template>` - Get template details
- `templates.list(): Promise<TemplateMetadata[]>` - List all templates
- `templates.delete(name: string): Promise<void>` - Delete template
- `destroy(): void` - Close SES client and clean up resources

## Requirements

- Node.js 16+
- AWS SES configured in your AWS account
- Verified sender email addresses in SES

## License

MIT

## Links

- [GitHub Repository](https://github.com/wraps-team/wraps-js)
- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [React Email](https://react.email)
