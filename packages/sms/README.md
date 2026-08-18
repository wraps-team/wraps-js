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

A simulator number is available immediately. A toll-free or 10DLC number has to
be registered with the carriers first, which takes days rather than seconds —
`npx wraps sms status` shows where that registration stands.

## Before your first send

Two AWS restrictions block a first send more often than anything in this SDK.
Both produce a typed error that names the fix, but they are cheaper to know
about up front.

**Your account starts in the SMS sandbox.** Every new AWS account is placed in
the [AWS End User Messaging SMS sandbox](https://docs.aws.amazon.com/sms-voice/latest/userguide/sandbox.html),
where:

- you can only send to destination numbers you have verified, up to 10 per account
- SMS spending is capped at $1.00 (USD) per month
- leaving the sandbox means opening an AWS Support case for production access,
  per region — AWS responds within 24 hours, and Wraps cannot grant it for you

You do not have to leave the sandbox to prove sending works. AWS publishes
[simulator destination numbers](https://docs.aws.amazon.com/sms-voice/latest/userguide/test-phone-numbers.html)
that accept messages and emit real delivery events without going over a carrier
network:

```typescript
await sms.send({
  to: '+14254147755', // US success simulator
  message: 'Hello from the sandbox',
});
```

`+14254147167` is the US failure simulator, useful for exercising your error
path. Other countries have their own pair. A simulator origination number can
only send to simulator destinations in the same country.

To send to a real number while still in the sandbox, verify it first:

```bash
npx wraps sms verify-number
```

**Everything is per-region.** Phone numbers, opt-out lists, verified
destinations, and production access all live in a single AWS region. A number
provisioned in `us-east-1` is invisible to a client pointed at `eu-west-1`, and
the error you get back reads like the number does not exist.

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

### Region

The SDK does not assume a region. It resolves one the way the AWS CLI does:

1. `region` passed to the constructor
2. `AWS_REGION`, then `AWS_DEFAULT_REGION`
3. the `region` key of the active profile in `~/.aws/config`
4. EC2/ECS instance metadata

```typescript
const sms = new WrapsSMS({ region: 'eu-west-1' });
```
```bash
export AWS_REGION=eu-west-1
```

If nothing in that chain supplies a region, the first call throws a
`ConfigurationError` listing every way to set one.

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

### `numbers.get(phoneNumberId)`

Get one phone number by its AWS resource ID. Resolves to `undefined` if the ID
is not in this account and region.

```typescript
const number = await sms.numbers.get('pn-123');

// Result
{
  phoneNumberId: 'pn-123',
  phoneNumber: '+18005551234',
  numberType: 'TOLL_FREE',
  messageType: 'TRANSACTIONAL',
  twoWayEnabled: false,
  registrationStatus: 'ACTIVE',
  isoCountryCode: 'US',
}
```

### `optOuts.list(optOutListName?)`

List every number on an opt-out list. Defaults to the `wraps-sms-optouts` list
that `wraps sms init` creates.

```typescript
const optedOut = await sms.optOuts.list();

// Result
[
  { phoneNumber: '+14155551234', optedOutAt: '2026-08-18T09:00:00.000Z' },
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

Every error this SDK throws extends `WrapsSMSError`, including credential and
region failures, so a single `instanceof WrapsSMSError` catches all of them.

```typescript
import {
  WrapsSMS,
  CredentialsError,
  ConfigurationError,
  SendingRestrictionError,
  SMSError,
  ValidationError,
  OptedOutError,
} from '@wraps.dev/sms';

try {
  await sms.send({ to: '+14155551234', message: 'Hello!' });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Invalid input:', error.field);
  } else if (error instanceof CredentialsError) {
    // AWS credentials could not be resolved. error.message lists every option.
    console.log(error.message);
  } else if (error instanceof ConfigurationError) {
    // No AWS region could be resolved.
    console.log(error.message);
  } else if (error instanceof SendingRestrictionError) {
    // AWS refused the send because of an account restriction, not the request.
    console.log(error.restriction, error.sandboxOnly);
    console.log(error.message); // names the fix for this specific restriction
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

### Error classes

| Class | Thrown when | Extra fields |
|-------|-------------|--------------|
| `ValidationError` | Input failed validation before any AWS call | `field` |
| `CredentialsError` | AWS credentials could not be resolved | `cause` |
| `ConfigurationError` | No AWS region could be resolved | `cause` |
| `SendingRestrictionError` | An account-level restriction blocked the send | `restriction`, `awsReason`, `sandboxOnly`, `requestId` |
| `OptedOutError` | The recipient is on the opt-out list | `phoneNumber` |
| `RateLimitError` | AWS throttled the request | `retryAfter` |
| `SMSError` | Any other AWS API failure | `code`, `requestId`, `retryable` |

`SendingRestrictionError.restriction` is one of
`SANDBOX_DESTINATION_NOT_VERIFIED`, `SANDBOX_VERIFIED_DESTINATION_LIMIT`,
`NO_ORIGINATION_IDENTITY`, `SPEND_LIMIT_REACHED`,
`ORIGINATION_IDENTITY_COUNTRY_MISMATCH`, `DESTINATION_COUNTRY_BLOCKED`, or
`ACCOUNT_DISABLED`. `sandboxOnly` tells you whether leaving the sandbox removes
the restriction.

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
