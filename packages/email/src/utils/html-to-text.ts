/**
 * Convert HTML to plain text for email fallback.
 *
 * Handles common email HTML patterns: block elements, line breaks,
 * lists, links, and HTML entities. No external dependencies.
 */
export function htmlToPlainText(html: string): string {
  let text = html;

  // Replace <br> variants with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Replace <hr> with a separator
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Extract href from links: <a href="url">text</a> → text (url)
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, linkText) => {
    const cleaned = linkText.replace(/<[^>]+>/g, '').trim();
    if (!cleaned || cleaned === href) return href;
    return `${cleaned} (${href})`;
  });

  // Add newlines before block-level elements
  text = text.replace(/<\/(p|div|h[1-6]|tr|blockquote|section|article|header|footer|main|aside|nav)>/gi, '\n\n');
  text = text.replace(/<(p|div|h[1-6]|tr|blockquote|section|article|header|footer|main|aside|nav)[\s>]/gi, '\n');

  // Handle list items
  text = text.replace(/<li[\s>][^>]*>/gi, '\n- ');
  text = text.replace(/<\/li>/gi, '');

  // Handle table cells with spacing
  text = text.replace(/<\/td>/gi, '\t');
  text = text.replace(/<\/th>/gi, '\t');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

  // Collapse runs of whitespace (but preserve newlines)
  text = text.replace(/[^\S\n]+/g, ' ');

  // Collapse 3+ consecutive newlines into 2
  text = text.replace(/\n{3,}/g, '\n\n');

  // Trim each line
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  return text.trim();
}
