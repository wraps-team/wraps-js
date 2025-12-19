# @wraps.dev/sms

Beautiful SMS SDK for AWS End User Messaging. Send SMS from your own AWS account with a developer-friendly API.

## Features

- **Your Infrastructure**: Messages sent through your AWS account
- **Simple API**: Send SMS with a single method call
- **OIDC Support**: Native support for Vercel, AWS EKS, and GitHub Actions
- **Type-Safe**: Full TypeScript support with comprehensive types
- **Batch Sending**: Send to multiple recipients efficiently
- **Opt-Out Management**: Built-in opt-out list handling

## Installation

```bash
npm install @wraps.dev/sms
```

## Quick Start

```typescript
import { WrapsSMS } from '@wraps.dev/sms';

const sms = new WrapsSMS();

// Send a message
const result = await sms.send({
  to: '+14155551234',
  message: 'Your verification code is 123456',
});

console.log(result.messageId);
```

## Prerequisites

Before using this SDK, you need to set up SMS infrastructure in your AWS account:

```bash
npx wraps sms init
```

This will provision:
- A phone number (toll-free or simulator)
- Configuration set for event tracking
- Opt-out list for compliance
- IAM role for OIDC authentication

## Authentication

The SDK supports multiple authentication methods:

### 1. AWS Credential Chain (Default)

```typescript
const sms = new WrapsSMS();
// Uses: env vars → ~/.aws/credentials → ECS/EC2 metadata
```

### 2. OIDC (Vercel, EKS, GitHub Actions)

```typescript
const sms = new WrapsSMS({
  roleArn: process.env.AWS_ROLE_ARN,
});
```

### 3. Explicit Credentials

```typescript
const sms = new WrapsSMS({
  credentials: {
    accessKeyId: 'AKIA...',
    secretAccessKey: '...',
  },
});
```

## API Reference

### `send(options)`

Send a single SMS message.

```typescript
const result = await sms.send({
  to: '+14155551234',           // Required: E.164 format
  message: 'Hello!',            // Required: Message body
  messageType: 'TRANSACTIONAL', // Optional: TRANSACTIONAL or PROMOTIONAL
  from: '+18005551234',         // Optional: Override sender
  context: { userId: '123' },   // Optional: Custom metadata
  dryRun: true,                 // Optional: Validate without sending
});

// Result
{
  messageId: 'msg-abc123',
  status: 'QUEUED',
  to: '+14155551234',
  from: '+18005551234',
  segments: 1,
}
```

### `sendBatch(options)`

Send messages to multiple recipients.

```typescript
const result = await sms.sendBatch({
  messages: [
    { to: '+14155551234', message: 'Hello Alice!' },
    { to: '+14155555678', message: 'Hello Bob!' },
  ],
  messageType: 'TRANSACTIONAL',
});

// Result
{
  batchId: 'batch-123',
  total: 2,
  queued: 2,
  failed: 0,
  results: [
    { to: '+14155551234', messageId: 'msg-1', status: 'QUEUED' },
    { to: '+14155555678', messageId: 'msg-2', status: 'QUEUED' },
  ],
}
```

### `numbers.list()`

List all phone numbers in your account.

```typescript
const numbers = await sms.numbers.list();

// Result
[
  {
    phoneNumberId: 'pn-123',
    phoneNumber: '+18005551234',
    numberType: 'TOLL_FREE',
    messageType: 'TRANSACTIONAL',
    twoWayEnabled: false,
  },
]
```

### `optOuts.check(phoneNumber)`

Check if a phone number has opted out.

```typescript
const isOptedOut = await sms.optOuts.check('+14155551234');

if (isOptedOut) {
  console.log('User has opted out');
}
```

### `optOuts.add(phoneNumber)`

Add a phone number to the opt-out list.

```typescript
await sms.optOuts.add('+14155551234');
```

### `optOuts.remove(phoneNumber)`

Remove a phone number from the opt-out list.

```typescript
await sms.optOuts.remove('+14155551234');
```

## Utilities

### `calculateSegments(message)`

Calculate how many SMS segments a message will use.

```typescript
import { calculateSegments } from '@wraps.dev/sms';

calculateSegments('Hello!');           // 1
calculateSegments('a'.repeat(200));    // 2
calculateSegments('Hello 🎉');         // 1 (Unicode)
```

### `validatePhoneNumber(phoneNumber, field)`

Validate a phone number is in E.164 format.

```typescript
import { validatePhoneNumber } from '@wraps.dev/sms';

validatePhoneNumber('+14155551234', 'to'); // OK
validatePhoneNumber('4155551234', 'to');   // Throws ValidationError
```

## Error Handling

```typescript
import { WrapsSMS, SMSError, ValidationError, OptedOutError } from '@wraps.dev/sms';

try {
  await sms.send({ to: '+14155551234', message: 'Hello!' });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Invalid input:', error.field);
  } else if (error instanceof OptedOutError) {
    console.log('User opted out:', error.phoneNumber);
  } else if (error instanceof SMSError) {
    console.log('AWS error:', error.code, error.message);
    if (error.retryable) {
      // Safe to retry
    }
  }
}
```

## Message Types

| Type | Use Case | Best Practices |
|------|----------|----------------|
| `TRANSACTIONAL` | OTP, alerts, notifications | Time-sensitive, user-initiated |
| `PROMOTIONAL` | Marketing, promotions | Requires explicit consent |

## Pricing

AWS End User Messaging charges per message segment:

| Component | Cost (US) |
|-----------|-----------|
| Toll-free number | $2/month |
| Outbound SMS | ~$0.00849/segment |
| Carrier fees | ~$0.003-0.006/segment |

## License

MIT
