/**
 * Wraps Project Configuration
 *
 * Identity functions for TypeScript intellisense when defining
 * wraps.config.ts and brand.ts files.
 */

export interface WrapsEnvironment {
  region?: string;
  from?: { email: string; name?: string };
  replyTo?: string;
}

export interface WrapsProjectConfig {
  /** Organization slug from wraps.dev */
  org: string;

  /** Default sender address */
  from?: { email: string; name?: string };

  /** Default reply-to address */
  replyTo?: string;

  /** AWS region for SES */
  region?: string;

  /** Environment-specific overrides */
  environments?: Record<string, WrapsEnvironment>;

  /** Default environment name */
  defaultEnv?: string;

  /** Path to templates directory (default: "./templates") */
  templatesDir?: string;

  /** Path to workflows directory (default: "./workflows") */
  workflowsDir?: string;

  /** Path to brand file (default: "./brand.ts") */
  brandFile?: string;

  /** Preview server options */
  preview?: { port?: number; open?: boolean };
}

export interface WrapsBrandKit {
  /** Primary brand color (hex) */
  primaryColor: string;

  /** Secondary brand color (hex) */
  secondaryColor?: string;

  /** Email background color (hex) */
  backgroundColor?: string;

  /** Text color (hex) */
  textColor?: string;

  /** Body font family */
  fontFamily?: string;

  /** Heading font family */
  headingFontFamily?: string;

  /** Button border radius (CSS value) */
  buttonRadius?: string;

  /** Button style preset */
  buttonStyle?: 'rounded' | 'square' | 'pill';

  /** Company name for footer */
  companyName?: string;

  /** Company address for CAN-SPAM compliance */
  companyAddress?: string;

  /** Logo URL */
  logoUrl?: string;

  /** Social media links */
  socialLinks?: Array<{ platform: string; url: string }>;
}

/**
 * Define your Wraps project configuration.
 * Use this in `wraps/wraps.config.ts` for full TypeScript intellisense.
 *
 * @example
 * ```ts
 * import { defineConfig } from '@wraps.dev/client';
 *
 * export default defineConfig({
 *   org: 'my-company',
 *   from: { email: 'hello@myapp.com', name: 'My App' },
 *   region: 'us-east-1',
 * });
 * ```
 */
export function defineConfig(config: WrapsProjectConfig): WrapsProjectConfig {
  return config;
}

/**
 * Define your brand kit for consistent email styling.
 * Use this in `wraps/brand.ts` for full TypeScript intellisense.
 *
 * @example
 * ```ts
 * import { defineBrand } from '@wraps.dev/client';
 *
 * export default defineBrand({
 *   primaryColor: '#5046e5',
 *   companyName: 'My Company',
 *   companyAddress: '123 Main St, City, ST 12345',
 * });
 * ```
 */
export function defineBrand(brand: WrapsBrandKit): WrapsBrandKit {
  return brand;
}
