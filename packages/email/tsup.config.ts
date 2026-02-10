import { defineConfig } from 'tsup';

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
  external: [
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-ses',
    '@aws-sdk/client-sesv2',
    '@aws-sdk/credential-providers',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/s3-request-presigner',
    '@react-email/components',
    'react',
  ],
});
