import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Mirrors tsup's define so tests see the same version the bundle ships.
  define: {
    __WRAPS_EMAIL_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        'examples/',
        'vitest.config.ts',
        'tsup.config.ts',
      ],
    },
  },
});
