/**
 * Escape a string for safe interpolation into HTML text/attribute context.
 * Escapes the five characters that can break out of HTML: & < > " '.
 *
 * @param value - Untrusted string (e.g. an inbound email subject or sender name).
 * @returns The HTML-escaped string.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
