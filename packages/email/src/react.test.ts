import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderReactEmail } from './react';

// Mock @react-email/components
vi.mock('@react-email/components', () => ({
  render: vi.fn(),
}));

describe('renderReactEmail', () => {
  it('should render React component to HTML and text', async () => {
    const { render } = await import('@react-email/components');

    // Mock the render function
    vi.mocked(render)
      .mockResolvedValueOnce('<html>Rendered HTML</html>')
      .mockResolvedValueOnce('Rendered Text');

    const component = React.createElement('div', null, 'Test');
    const result = await renderReactEmail(component);

    expect(result).toEqual({
      html: '<html>Rendered HTML</html>',
      text: 'Rendered Text',
    });

    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenNthCalledWith(1, component, { pretty: false });
    expect(render).toHaveBeenNthCalledWith(2, component, { plainText: true });
  });

  it('should throw error when render fails', async () => {
    const { render } = await import('@react-email/components');

    vi.mocked(render).mockRejectedValueOnce(new Error('Render failed'));

    const component = React.createElement('div', null, 'Test');

    await expect(renderReactEmail(component)).rejects.toThrow(
      'Failed to render React email component'
    );
  });

  it('should handle MODULE_NOT_FOUND error', async () => {
    const { render } = await import('@react-email/components');

    const error = new Error('Cannot find module');
    (error as any).code = 'MODULE_NOT_FOUND';
    vi.mocked(render).mockRejectedValueOnce(error);

    const component = React.createElement('div', null, 'Test');

    await expect(renderReactEmail(component)).rejects.toThrow('React Email not installed');
  });
});
