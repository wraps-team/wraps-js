import { WrapsSMS } from '@wraps.dev/sms';

// Create SMS client (uses AWS credential chain by default)
const sms = new WrapsSMS();

// Send a simple SMS
async function sendOTP(phoneNumber: string, code: string) {
  const result = await sms.send({
    to: phoneNumber,
    message: `Your verification code is ${code}. Valid for 10 minutes.`,
    messageType: 'TRANSACTIONAL',
    context: {
      type: 'otp',
      userId: 'user_123',
    },
  });

  console.log('Message sent:', result.messageId);
  console.log('Segments:', result.segments);

  return result.messageId;
}

// Check opt-out status before sending
async function sendNotification(phoneNumber: string, message: string) {
  // Check if user has opted out
  const isOptedOut = await sms.optOuts.check(phoneNumber);

  if (isOptedOut) {
    console.log('User has opted out, skipping message');
    return null;
  }

  // Send the notification
  const result = await sms.send({
    to: phoneNumber,
    message,
    messageType: 'TRANSACTIONAL',
  });

  return result.messageId;
}

// Dry run (validate without sending)
async function validateMessage(phoneNumber: string, message: string) {
  const result = await sms.send({
    to: phoneNumber,
    message,
    dryRun: true,
  });

  console.log('Dry run result:', result);
  console.log('Would use', result.segments, 'segment(s)');
}

// Example usage
async function main() {
  try {
    // Send OTP
    await sendOTP('+14155551234', '123456');

    // Send notification with opt-out check
    await sendNotification('+14155551234', 'Your order has shipped!');

    // Validate a message without sending
    await validateMessage('+14155551234', 'Test message');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Clean up
    sms.destroy();
  }
}

main();
