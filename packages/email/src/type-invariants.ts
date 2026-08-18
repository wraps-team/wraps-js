/**
 * Compile-time tests for the `SendEmailParams` body invariants.
 *
 * Not part of the public API and not reachable from any entry point, so it is
 * never bundled — but it *is* covered by `pnpm typecheck`. Each
 * `@ts-expect-error` fails the build if the invalid case below ever starts
 * compiling again, which is exactly the regression this file guards: both
 * invariants used to be runtime-only, so agent-generated code compiled clean
 * and threw in production.
 */
import type React from 'react';
import type { SendEmailParams } from './types';
import type { WorkerSendEmailParams } from './workers-client';

const from = 'sender@example.com';
const to = 'recipient@example.com';
const subject = 'Subject';
// A stand-in element: `never` would be assignable to the `react?: never` slot
// and would quietly defeat the mutual-exclusion check below.
const reactBody = {} as React.ReactElement;

export const htmlOnly: SendEmailParams = { from, to, subject, html: '<p>hi</p>' };
export const textOnly: SendEmailParams = { from, to, subject, text: 'hi' };
export const htmlAndText: SendEmailParams = { from, to, subject, html: '<p>hi</p>', text: 'hi' };

// No body at all — previously compiled, threw "Must provide at least one of:
// html, text, or react" at runtime.
// @ts-expect-error - a send needs one of html, react, or text
export const noBody: SendEmailParams = { from, to, subject };

// Both bodies — previously compiled, threw "Cannot provide both" at runtime.
// @ts-expect-error - html and react are mutually exclusive
export const htmlAndReact: SendEmailParams = {
  from,
  to,
  subject,
  html: '<p>hi</p>',
  react: reactBody,
};

// A body typed `string | undefined` is not a body: it may be absent at runtime.
// @ts-expect-error - html must be a string, not string | undefined
export const maybeHtml: SendEmailParams = {
  from,
  to,
  subject,
  html: undefined as string | undefined,
};

// The edge entry narrows the same union rather than flattening it.
export const workerHtml: WorkerSendEmailParams = { from, to, subject, html: '<p>hi</p>' };

// @ts-expect-error - the edge entry still requires a body
export const workerNoBody: WorkerSendEmailParams = { from, to, subject };

// @ts-expect-error - react is not supported at the edge
export const workerReact: WorkerSendEmailParams = { from, to, subject, react: reactBody };
