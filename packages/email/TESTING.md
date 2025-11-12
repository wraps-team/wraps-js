# Testing Guide for @wraps.dev/email

This guide covers how to run tests and test with AWS SES sandbox.

## Running Tests

### Unit Tests

Run all unit tests:
```bash
pnpm test
```

Watch mode (auto-rerun on changes):
```bash
pnpm test:watch
```

With coverage report:
```bash
pnpm test:coverage
```

Coverage reports are generated in the `coverage/` directory.

### Integration Tests

Integration tests require actual AWS SES credentials and verified email addresses.

#### Prerequisites

1. **AWS Account** with SES access
2. **Verified email addresses** in SES (sandbox mode)
3. **AWS credentials** configured

#### Setup AWS Credentials

**Option 1: Environment Variables**
```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1
```

**Option 2: AWS Credentials File**
```bash
# ~/.aws/credentials
[default]
aws_access_key_id = your_access_key
aws_secret_access_key = your_secret_key
```

#### Run Integration Tests

```bash
# Set required environment variables
export TEST_FROM_EMAIL=verified-sender@yourdomain.com
export TEST_TO_EMAIL=verified-recipient@yourdomain.com

# Run integration tests
pnpm test:integration
```

## Testing with AWS SES Sandbox

### What is SES Sandbox?

All new AWS SES accounts start in **sandbox mode**, which has the following restrictions:
- Can only send emails TO verified addresses
- Can only send emails FROM verified addresses
- Limited to 200 emails per day
- Maximum send rate of 1 email per second

### Step 1: Verify Email Addresses

1. Go to [AWS SES Console](https://console.aws.amazon.com/ses/)
2. Navigate to **Verified identities**
3. Click **Create identity**
4. Choose **Email address**
5. Enter your email address
6. Click **Create identity**
7. Check your inbox and click the verification link
8. Repeat for both sender and recipient addresses

### Step 2: Test Email Sending

Once you have verified addresses, you can test:

```typescript
import { WrapsEmail } from '@wraps.dev/email';

const email = new WrapsEmail({
  region: 'us-east-1', // Your SES region
});

// Both addresses must be verified in SES sandbox
await email.send({
  from: 'verified-sender@yourdomain.com',
  to: 'verified-recipient@yourdomain.com',
  subject: 'Test Email',
  html: '<h1>Hello!</h1>',
});
```

### Step 3: Moving Out of Sandbox

To send emails to any address, you need to [request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html):

1. Go to AWS SES Console
2. Click **Get Set Up** or **Account Dashboard**
3. Request production access
4. Fill out the form explaining your use case
5. AWS typically approves within 24 hours

## Manual Testing Checklist

### Basic Email Sending
- [ ] Send simple HTML email
- [ ] Send plain text email
- [ ] Send with both HTML and text
- [ ] Send to multiple recipients
- [ ] Send with CC and BCC
- [ ] Send with Reply-To
- [ ] Send with custom tags
- [ ] Send with configuration set

### React.email Integration
- [ ] Send with React component
- [ ] Verify HTML rendering
- [ ] Verify plain text generation

### Template Management
- [ ] Create template
- [ ] List templates
- [ ] Get template details
- [ ] Update template
- [ ] Send using template
- [ ] Send bulk using template
- [ ] Delete template

### Error Handling
- [ ] Invalid email address
- [ ] Missing required fields
- [ ] Unverified sender (in sandbox)
- [ ] Rate limit errors
- [ ] Network errors

## Testing with LocalStack

For local development without AWS, you can use LocalStack:

### Setup LocalStack

```bash
# Using Docker
docker run -d \
  -p 4566:4566 \
  -e SERVICES=ses \
  localstack/localstack
```

### Configure Client for LocalStack

```typescript
const email = new WrapsEmail({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});
```

**Note:** LocalStack has limited SES functionality and is best for basic testing only.

## Troubleshooting

### "Email address not verified"

**Problem:** Error when sending to an address in SES sandbox.

**Solution:**
1. Verify both sender and recipient addresses in SES console
2. Check verification status in AWS SES Console
3. Make sure you clicked the verification link in the email

### "Rate limit exceeded"

**Problem:** Sending too many emails too quickly.

**Solution:**
- Wait a few seconds between sends
- In sandbox: max 1 email/second, 200/day
- Request production access for higher limits

### "Access denied"

**Problem:** AWS credentials don't have SES permissions.

**Solution:**
Ensure your IAM user/role has these permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendTemplatedEmail",
        "ses:SendBulkTemplatedEmail",
        "ses:CreateTemplate",
        "ses:UpdateTemplate",
        "ses:GetTemplate",
        "ses:ListTemplates",
        "ses:DeleteTemplate"
      ],
      "Resource": "*"
    }
  ]
}
```

### "Module not found: @react-email/components"

**Problem:** React.email is a peer dependency.

**Solution:**
```bash
pnpm add @react-email/components react
```

## Best Practices

1. **Don't commit credentials** - Use environment variables
2. **Use sandbox for testing** - Don't spam real users
3. **Verify addresses first** - Avoids errors in sandbox
4. **Mock in unit tests** - Use vitest mocks, not real AWS calls
5. **Integration tests sparingly** - They're slow and cost money
6. **Monitor SES quotas** - Check bounce rate and complaint rate
7. **Use tags** - Track different email types for analytics

## CI/CD Testing

Our GitHub Actions workflow runs unit tests automatically on every push.

Integration tests are NOT run in CI because they require:
- AWS credentials
- Verified email addresses
- Real AWS resources

Run integration tests manually before releasing new versions.

## Coverage Goals

- **Target:** >80% code coverage
- **Check coverage:** `npm run test:coverage`
- **View report:** Open `coverage/index.html` in a browser

Current coverage:
```bash
npm run test:coverage
```

## Need Help?

- AWS SES Documentation: https://docs.aws.amazon.com/ses/
- Vitest Documentation: https://vitest.dev/
- Report issues: https://github.com/wraps-team/wraps-js/issues
