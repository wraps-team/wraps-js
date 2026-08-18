import { defineConfig } from 'tsup';
// Resolved relative to this file, not the working directory, so a build
// launched from the repo root can't stamp in the wrong package's version.
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false, // Keep readable for debugging
  outDir: 'dist',
  external: ['@aws-sdk/client-pinpoint-sms-voice-v2', '@vercel/oidc-aws-credentials-provider'],
  define: {
    __WRAPS_SMS_VERSION__: JSON.stringify(pkg.version),
  },
});
