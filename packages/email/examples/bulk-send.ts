import { WrapsEmail } from '@wraps.dev/email';

async function main() {
  const email = new WrapsEmail({
    region: 'us-east-1',
  });

  // First, create a template for bulk sending
  await email.templates.create({
    name: 'weekly-digest',
    subject: 'Your Weekly Digest - {{unreadCount}} new items',
    html: `
      <h1>Hi {{name}}!</h1>
      <p>You have {{unreadCount}} unread items this week.</p>
      <a href="{{dashboardUrl}}">View Dashboard</a>
    `,
    text: 'Hi {{name}}! You have {{unreadCount}} unread items.',
  });

  // Send to multiple recipients with personalized data (max 50)
  const results = await email.sendBulkTemplate({
    from: 'sender@example.com',
    template: 'weekly-digest',
    destinations: [
      {
        to: 'alice@example.com',
        templateData: {
          name: 'Alice',
          unreadCount: 5,
          dashboardUrl: 'https://example.com/dashboard?user=alice',
        },
      },
      {
        to: 'bob@example.com',
        templateData: {
          name: 'Bob',
          unreadCount: 12,
          dashboardUrl: 'https://example.com/dashboard?user=bob',
        },
      },
      {
        to: 'charlie@example.com',
        templateData: {
          name: 'Charlie',
          unreadCount: 3,
          dashboardUrl: 'https://example.com/dashboard?user=charlie',
        },
      },
    ],
    defaultTemplateData: {
      companyName: 'Acme Corp',
    },
  });

  console.log('Bulk send completed!');
  results.status.forEach((result, index) => {
    if (result.status === 'success') {
      console.log(`✓ Email ${index + 1}: ${result.messageId}`);
    } else {
      console.log(`✗ Email ${index + 1} failed: ${result.error}`);
    }
  });

  // Cleanup
  await email.templates.delete('weekly-digest');
}

main().catch(console.error);
