# CLAUDE.md - Wraps JS SDKs

## Project Overview

Monorepo containing three TypeScript SDKs for AWS services, published under the `@wraps.dev` npm namespace:

- **@wraps.dev/email** (v0.9.0) - Email SDK for AWS SES with React.email support
- **@wraps.dev/sms** (v0.1.2) - SMS SDK for AWS End User Messaging (Pinpoint SMS Voice V2)
- **@wraps.dev/client** (v0.6.1) - Type-safe API client for the Wraps Platform (OpenAPI-generated)

## Key Principles

- **BYOC (Bring Your Own Credentials)**: SDKs call AWS APIs directly in the user's account
- **Zero Vendor Lock-in**: Thin wrappers around AWS services, swap anytime
- **Dual Module Support**: All packages export both CJS and ESM
- **Type-Safe**: Strict TypeScript throughout

## Package Structure

```
wraps-js/
├── packages/
│   ├── email/                 # @wraps.dev/email
│   │   ├── src/
│   │   │   ├── index.ts       # Public exports
│   │   │   ├── client.ts      # WrapsEmail class
│   │   │   ├── types.ts       # Type definitions
│   │   │   ├── errors.ts      # Error classes
│   │   │   ├── events.ts      # Email event history (DynamoDB)
│   │   │   ├── inbox.ts       # Inbox API (S3)
│   │   │   ├── react.ts       # React.email rendering
│   │   │   ├── suppression.ts # Suppression list management
│   │   │   ├── batch.ts       # Batch sending
│   │   │   └── utils/         # Credentials, validation, MIME
│   │   └── examples/          # Usage examples
│   ├── sms/                   # @wraps.dev/sms
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client.ts      # WrapsSMS class
│   │   │   ├── types.ts
│   │   │   ├── errors.ts
│   │   │   └── utils/         # Credentials, E.164 validation
│   │   └── examples/
│   └── client/                # @wraps.dev/client
│       └── src/
│           ├── index.ts
│           ├── client.ts      # createPlatformClient (openapi-fetch)
│           ├── config.ts      # defineConfig, defineBrand
│           ├── workflow*.ts   # Workflow definitions
│           └── schema.d.ts    # Auto-generated OpenAPI types
├── biome.json                 # Code style (100 char width, single quotes, 2-space indent)
└── CONTRIBUTING.md
```

## Critical Rules

### 1. Credential Resolution Priority

All SDKs follow the same credential chain. Never change this order:

```typescript
// Priority 1: Pre-configured AWS client
const email = new WrapsEmail({ client: existingSESClient });

// Priority 2: OIDC role assumption (Vercel, GitHub Actions, EKS)
const email = new WrapsEmail({ roleArn: 'arn:aws:iam::123:role/MyRole' });

// Priority 3: Explicit credentials (static or provider function)
const email = new WrapsEmail({ credentials: { accessKeyId, secretAccessKey } });

// Priority 4: AWS credential chain (automatic — env vars, ~/.aws/credentials, etc.)
const email = new WrapsEmail();
```

Credentials can be a static object OR a provider function. Detect with:
```typescript
if (typeof config.credentials === 'function' || !('accessKeyId' in config.credentials)) {
  // Provider function — pass directly
} else {
  // Static credentials — destructure
}
```

### 2. Error Hierarchy

Both email and SMS follow the same pattern:

```
WrapsEmailError / WrapsSMSError (base)
├── ValidationError       (invalid input, has .field?)
├── SESError / SMSError   (AWS API error, has .code, .requestId, .retryable)
├── BatchError            (partial failure, has .results, .successCount, .failureCount)
├── DynamoDBError         (email events, has .code, .requestId, .retryable)
├── OptedOutError         (SMS only, has .phoneNumber)
└── RateLimitError        (SMS only, has .retryAfter?)
```

Always set `this.name` in error constructors. Always include `retryable` boolean on AWS errors.

### 3. AWS SDK Is External — Never Bundle It

All `@aws-sdk/*` packages are marked `external` in tsup. They're peer dependencies, not bundled:

```typescript
// tsup.config.ts
external: ['@aws-sdk/*', 'react', '@react-email/components'],
```

### 4. Dual CJS + ESM Output

```typescript
// tsup.config.ts
format: ['cjs', 'esm'],
dts: true,
```

Output: `dist/index.js` (CJS), `dist/index.mjs` (ESM), `dist/index.d.ts` (types).

### 5. All Public Methods Need JSDoc

```typescript
/**
 * Send an email via AWS SES
 *
 * @param params - Send options
 * @returns Promise resolving to send result with messageId
 * @throws {ValidationError} If email parameters are invalid
 * @throws {SESError} If AWS SES API call fails
 *
 * @example
 * ```typescript
 * const result = await email.send({
 *   from: 'sender@example.com',
 *   to: 'recipient@example.com',
 *   subject: 'Hello!',
 *   html: '<h1>Hello World</h1>',
 * });
 * ```
 */
```

## Public APIs

### WrapsEmail
```typescript
class WrapsEmail {
  send(params): Promise<SendEmailResult>;
  sendBatch(params): Promise<SendBatchResult>;
  sendTemplate(params): Promise<SendEmailResult>;
  sendBulkTemplate(params): Promise<SendBulkTemplateResult>;

  templates: {
    create(params): Promise<void>;
    createFromReact(params): Promise<void>;
    update(params): Promise<void>;
    get(name): Promise<Template>;
    list(): Promise<TemplateMetadata[]>;
    delete(name): Promise<void>;
  };

  inbox: WrapsInbox | null;          // Enabled when inboxBucketName provided
  events: WrapsEmailEvents | null;   // Enabled when historyTableName provided
  suppression: WrapsEmailSuppression;

  destroy(): void;
}
```

### WrapsSMS
```typescript
class WrapsSMS {
  send(options): Promise<SendResult>;
  sendBatch(options): Promise<BatchResult>;

  numbers: {
    list(): Promise<PhoneNumber[]>;
    get(phoneNumberId): Promise<PhoneNumber | undefined>;
  };

  optOuts: {
    list(optOutListName?): Promise<OptOutEntry[]>;
    check(phoneNumber, optOutListName?): Promise<boolean>;
    add(phoneNumber, optOutListName?): Promise<void>;
    remove(phoneNumber, optOutListName?): Promise<void>;
  };

  destroy(): void;
}
```

### Platform Client
```typescript
const client = createPlatformClient({ apiKey: 'sk_...' });
const { data, error } = await client.GET('/v1/contacts/', {
  params: { query: { page: '1', pageSize: '10' } },
});
```

## Optional Features Pattern

Features are enabled by config. Expose as nullable properties:

```typescript
constructor(config: WrapsEmailConfig = {}) {
  this.inbox = config.inboxBucketName ? new WrapsInbox(...) : null;
  this.events = config.historyTableName ? new WrapsEmailEvents(...) : null;
  this.suppression = new WrapsEmailSuppression(...); // Always available
}
```

Users check before using: `if (email.inbox) { ... }`

## Type Exports

Export types alongside implementations from `index.ts`:
```typescript
export { WrapsEmail };
export { SESError, ValidationError, BatchError, WrapsEmailError };
export type { SendEmailParams, SendEmailResult, Attachment, /* ... */ };
export { calculateSegments, validatePhoneNumber }; // Utility exports for SMS
```

## Development

```bash
pnpm install            # Install deps
pnpm build              # Build all packages
pnpm test               # Run tests (Vitest)
pnpm test:watch         # Watch mode
pnpm test:coverage      # Coverage report
pnpm lint               # Biome check
pnpm lint:fix           # Auto-fix
pnpm typecheck          # Type check
```

### Testing Pattern

Mock AWS SDK at module level before importing the SDK:

```typescript
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: class MockClient { send = mockSend; },
  SendEmailCommand: class MockCommand {
    constructor(input: unknown) { this.input = input; }
  },
}));
```

Always `vi.clearAllMocks()` in `afterEach()`.

## Publishing

Each package has independent versioning. GitHub Actions publishes on release.

```bash
# Tag format: {package}-v{version}
# e.g., email-v0.9.1, sms-v0.1.3, client-v0.6.2
```

Manual: `cd packages/email && pnpm clean && pnpm build && npm publish --access public`

## Notes for Claude

- Follow established patterns in existing code — all 3 SDKs share conventions
- All public methods need JSDoc with `@example`, `@throws`, `@param`, `@returns`
- Test error properties (code, requestId, retryable, field) not just error types
- Support both static credentials and provider functions
- Never bundle AWS SDK or React — mark as external
- Run `pnpm lint:fix`, `pnpm typecheck`, `pnpm test` before committing
- Update README.md when adding public APIs
