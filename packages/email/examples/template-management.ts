import { WrapsEmail } from '@wraps-js/email';

async function main() {
  const email = new WrapsEmail({
    region: 'us-east-1',
  });

  // Create a new template
  await email.templates.create({
    name: 'welcome-email',
    subject: 'Welcome to {{companyName}}, {{name}}!',
    html: `
      <h1>Welcome {{name}}!</h1>
      <p>We're excited to have you at {{companyName}}.</p>
      <p>Click to confirm: <a href="{{confirmUrl}}">Confirm Account</a></p>
    `,
    text: 'Welcome {{name}}! Click to confirm: {{confirmUrl}}',
  });
  console.log('Template created successfully!');

  // Send using the template
  const result = await email.sendTemplate({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    template: 'welcome-email',
    templateData: {
      name: 'John Doe',
      companyName: 'Acme Corp',
      confirmUrl: 'https://example.com/confirm/abc123',
    },
  });
  console.log('Email sent using template!', result.messageId);

  // List all templates
  const templates = await email.templates.list();
  console.log('Available templates:', templates.map(t => t.name));

  // Get template details
  const template = await email.templates.get('welcome-email');
  console.log('Template details:', template);

  // Update template
  await email.templates.update({
    name: 'welcome-email',
    subject: 'Welcome aboard, {{name}}!',
  });
  console.log('Template updated!');

  // Delete template (cleanup)
  await email.templates.delete('welcome-email');
  console.log('Template deleted!');
}

main().catch(console.error);
