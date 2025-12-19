# Wraps JavaScript/TypeScript SDKs

Beautiful SDKs for building with AWS services.

## Packages

### [@wraps.dev/email](./packages/email)

Beautiful email SDK for AWS SES with React.email support.

**Features:**
- Resend-like developer experience but calls your SES directly (BYOC model)
- Full TypeScript support
- React.email integration for beautiful templates
- Automatic AWS credential chain resolution
- Template management (create, update, delete, list)
- Bulk email sending (up to 50 recipients)
- Zero vendor lock-in

**Installation:**
```bash
npm install @wraps.dev/email
```

**Quick Start:**
```typescript
import { WrapsEmail } from '@wraps.dev/email';

const email = new WrapsEmail({ region: 'us-east-1' });

await email.send({
  from: 'you@company.com',
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello World</h1>',
});
```

### [@wraps.dev/sms](./packages/sms)

Beautiful SMS SDK for AWS End User Messaging.

**Features:**
- Send SMS from your own AWS account (BYOC model)
- Full TypeScript support
- OIDC authentication for Vercel, EKS, GitHub Actions
- Batch sending to multiple recipients
- Opt-out list management
- Phone number validation (E.164)

**Installation:**
```bash
npm install @wraps.dev/sms
```

**Quick Start:**
```typescript
import { WrapsSMS } from '@wraps.dev/sms';

const sms = new WrapsSMS();

await sms.send({
  to: '+14155551234',
  message: 'Your verification code is 123456',
});
```

### @wraps.dev/workflows (Coming Soon)

Workflow orchestration SDK.

## Development

This is a monorepo managed with **pnpm** containing all Wraps JavaScript/TypeScript SDKs.

### Prerequisites

Install pnpm globally:
```bash
npm install -g pnpm
# or
corepack enable
```

### Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Lint
pnpm lint

# Format code
pnpm format

# Type check
pnpm typecheck
```

## License

MIT
