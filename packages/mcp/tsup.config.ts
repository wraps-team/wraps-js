import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  outDir: 'dist',
  external: ['@aws-sdk/*', '@wraps.dev/email', '@modelcontextprotocol/sdk'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
