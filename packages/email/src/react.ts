import type React from 'react';

/**
 * Render React.email component to HTML string
 */
export async function renderReactEmail(
  component: React.ReactElement
): Promise<{ html: string; text: string }> {
  try {
    // Dynamically import @react-email/components to make it optional
    const { render } = await import('@react-email/components');

    // Render to HTML
    const html = await render(component, {
      pretty: false, // Minified for email
    });

    // Render to plain text (react-email provides this)
    const text = await render(component, {
      plainText: true,
    });

    return { html, text };
  } catch (error: any) {
    if (error.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'React Email not installed. Install @react-email/components to use React templates.'
      );
    }
    throw new Error(
      `Failed to render React email component: ${error.message}`
    );
  }
}
