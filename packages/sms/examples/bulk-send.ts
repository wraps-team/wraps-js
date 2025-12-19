import { WrapsSMS } from '@wraps.dev/sms';

const sms = new WrapsSMS();

interface User {
  id: string;
  name: string;
  phone: string;
  orderId: string;
}

// Send batch notifications
async function sendBatchNotifications(users: User[]) {
  const result = await sms.sendBatch({
    messages: users.map((user) => ({
      to: user.phone,
      message: `Hi ${user.name}, your order #${user.orderId} has shipped!`,
      context: {
        userId: user.id,
        orderId: user.orderId,
      },
    })),
    messageType: 'TRANSACTIONAL',
  });

  console.log(`Batch ID: ${result.batchId}`);
  console.log(`Total: ${result.total}`);
  console.log(`Queued: ${result.queued}`);
  console.log(`Failed: ${result.failed}`);

  // Check individual results
  result.results.forEach((r) => {
    if (r.status === 'FAILED') {
      console.error(`Failed to send to ${r.to}: ${r.error}`);
    }
  });

  return result;
}

// Example usage
async function main() {
  const users: User[] = [
    { id: '1', name: 'Alice', phone: '+14155551234', orderId: 'ORD-001' },
    { id: '2', name: 'Bob', phone: '+14155555678', orderId: 'ORD-002' },
    { id: '3', name: 'Charlie', phone: '+14155559012', orderId: 'ORD-003' },
  ];

  try {
    await sendBatchNotifications(users);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    sms.destroy();
  }
}

main();
