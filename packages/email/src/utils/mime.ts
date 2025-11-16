import type { Attachment, EmailAddress } from '../types';

/**
 * Generate a random boundary string for MIME multipart messages
 */
function generateBoundary(prefix = 'boundary'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Encode email address with optional name
 */
function formatEmailAddress(address: string | EmailAddress): string {
  if (typeof address === 'string') {
    return address;
  }
  if (address.name) {
    // Properly quote and escape name if it contains special characters
    const name = address.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${name}" <${address.email}>`;
  }
  return address.email;
}

/**
 * Encode email addresses array
 */
function formatEmailAddresses(
  addresses: string | string[] | EmailAddress | EmailAddress[]
): string {
  const addressArray = Array.isArray(addresses) ? addresses : [addresses];
  return addressArray.map(formatEmailAddress).join(', ');
}

/**
 * Encode attachment content to base64 and split into 76-character lines (RFC 2045)
 */
function encodeAttachment(content: Buffer | string): string {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'base64') : content;
  const base64 = buffer.toString('base64');
  // Split into 76-character lines as per RFC 2045
  return base64.match(/.{1,76}/g)?.join('\r\n') || base64;
}

/**
 * Get MIME type from filename if not provided
 */
function getMimeType(filename: string, providedType?: string): string {
  if (providedType) {
    return providedType;
  }

  // Basic MIME type detection based on extension
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    txt: 'text/plain',
    html: 'text/html',
    csv: 'text/csv',
    zip: 'application/zip',
    json: 'application/json',
  };

  return mimeTypes[ext || ''] || 'application/octet-stream';
}

export interface BuildRawEmailParams {
  from: string | EmailAddress;
  to: string | string[] | EmailAddress | EmailAddress[];
  cc?: string | string[] | EmailAddress | EmailAddress[];
  bcc?: string | string[] | EmailAddress | EmailAddress[];
  replyTo?: string | string[] | EmailAddress | EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  attachments: Attachment[];
}

/**
 * Build a MIME-formatted raw email message with attachments
 */
export function buildRawEmailMessage(params: BuildRawEmailParams): string {
  const lines: string[] = [];

  // Generate boundaries
  const mainBoundary = generateBoundary('main');
  const altBoundary = generateBoundary('alt');

  // Email headers
  lines.push(`From: ${formatEmailAddress(params.from)}`);
  lines.push(`To: ${formatEmailAddresses(params.to)}`);

  if (params.cc) {
    lines.push(`Cc: ${formatEmailAddresses(params.cc)}`);
  }

  if (params.bcc) {
    lines.push(`Bcc: ${formatEmailAddresses(params.bcc)}`);
  }

  if (params.replyTo) {
    lines.push(`Reply-To: ${formatEmailAddresses(params.replyTo)}`);
  }

  lines.push(`Subject: ${params.subject}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${mainBoundary}"`);
  lines.push(''); // Blank line separates headers from body

  // Start main multipart/mixed (for attachments)
  lines.push(`--${mainBoundary}`);

  // Check if we need multipart/alternative for text and HTML
  if (params.text && params.html) {
    // Both text and HTML - use multipart/alternative
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push('');

    // Text version
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(params.text);
    lines.push('');

    // HTML version
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(params.html);
    lines.push('');

    lines.push(`--${altBoundary}--`);
  } else if (params.html) {
    // HTML only
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(params.html);
  } else if (params.text) {
    // Text only
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(params.text);
  }

  lines.push('');

  // Add attachments
  for (const attachment of params.attachments) {
    const mimeType = getMimeType(attachment.filename, attachment.contentType);
    const encoding = attachment.encoding || 'base64';

    lines.push(`--${mainBoundary}`);
    lines.push(`Content-Type: ${mimeType}; name="${attachment.filename}"`);
    lines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
    lines.push(`Content-Transfer-Encoding: ${encoding}`);
    lines.push('');

    if (encoding === 'base64') {
      lines.push(encodeAttachment(attachment.content));
    } else {
      // For other encodings, assume content is already properly encoded
      const content =
        typeof attachment.content === 'string' ? attachment.content : attachment.content.toString();
      lines.push(content);
    }

    lines.push('');
  }

  // End main boundary
  lines.push(`--${mainBoundary}--`);

  // Join with CRLF (required by MIME spec)
  return lines.join('\r\n');
}
