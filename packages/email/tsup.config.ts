import { defineConfig } from 'tsup';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Bake the published version in, so the AWS customUserAgent can't drift from
  // the manifest.
  define: {
    __WRAPS_EMAIL_VERSION__: JSON.stringify(pkg.version),
  },
  entry: ['src/index.ts', 'src/workers.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false, // Keep readable for debugging
  outDir: 'dist',
  external: [
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-ses',
    '@aws-sdk/client-sesv2',
    '@aws-sdk/client-ssm',
    '@aws-sdk/credential-providers',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/s3-request-presigner',
    '@vercel/oidc-aws-credentials-provider',
    '@react-email/components',
    'react',
  ],
});
