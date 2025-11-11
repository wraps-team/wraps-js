# Wraps JavaScript/TypeScript SDKs

Beautiful SDKs for building with AWS services.

## Packages

### [@wraps/email](./packages/email)

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
npm install @wraps/email
```

**Quick Start:**
```typescript
import { WrapsEmail } from '@wraps/email';

const email = new WrapsEmail({ region: 'us-east-1' });

await email.send({
  from: 'you@company.com',
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello World</h1>',
});
```

### @wraps/sms (Coming Soon)

SMS SDK for AWS SNS.

### @wraps/workflows (Coming Soon)

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
