import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESError, ValidationError } from './errors';
import { htmlToPlainText } from './utils/html-to-text';
import { WrapsEmail } from './workers-client';

const CREDS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const BASE = { region: 'us-east-1', credentials: CREDS } as const;

function okResponse(messageId = 'msg-abc', requestId = 'req-xyz') {
  return new Response(JSON.stringify({ MessageId: messageId }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-amzn-RequestId': requestId },
  });
}

describe('WrapsEmail (workers)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('1. posts to the correct SESv2 endpoint and returns messageId + requestId', async () => {
    const email = new WrapsEmail(BASE);
    const result = await email.send({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const req: Request = fetchMock.mock.calls[0][0];
    expect(req.url).toBe('https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');
    expect(req.method).toBe('POST');
    expect(result).toEqual({ messageId: 'msg-abc', requestId: 'req-xyz' });
  });

  it('2. builds the correct SESv2 JSON body shape', async () => {
    const email = new WrapsEmail(BASE);
    await email.send({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
    });

    const req: Request = fetchMock.mock.calls[0][0];
    const body = JSON.parse(await req.text());

    expect(body.FromEmailAddress).toBe('sender@example.com');
    expect(body.Destination.ToAddresses).toEqual(['recipient@example.com']);
    expect(body.Content.Simple.Subject.Data).toBe('Test Subject');
    expect(body.Content.Simple.Body.Html.Data).toBe('<p>Hello</p>');
  });

  it('3. auto-generates plain text from html when text is omitted', async () => {
    const html = '<p>Hi <b>there</b></p>';
    const email = new WrapsEmail(BASE);
    await email.send({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test',
      html,
    });

    const req: Request = fetchMock.mock.calls[0][0];
    const body = JSON.parse(await req.text());

    expect(body.Content.Simple.Body.Text.Data).toBe(htmlToPlainText(html));
  });

  it('4. includes optional fields: cc, bcc, replyTo, tags, configurationSetName', async () => {
    const email = new WrapsEmail(BASE);
    await email.send({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      replyTo: 'reply@example.com',
      subject: 'Test',
      html: '<p>Hello</p>',
      tags: { category: 'transactional' },
      configurationSetName: 'my-config-set',
    });

    const req: Request = fetchMock.mock.calls[0][0];
    const body = JSON.parse(await req.text());

    expect(body.Destination.CcAddresses).toEqual(['cc@example.com']);
    expect(body.Destination.BccAddresses).toEqual(['bcc@example.com']);
    expect(body.ReplyToAddresses).toEqual(['reply@example.com']);
    expect(body.EmailTags).toEqual([{ Name: 'category', Value: 'transactional' }]);
    expect(body.ConfigurationSetName).toBe('my-config-set');
  });

  it('5. signs the request with AWS4-HMAC-SHA256', async () => {
    const email = new WrapsEmail(BASE);
    await email.send({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
    });

    const req: Request = fetchMock.mock.calls[0][0];
    const auth = req.headers.get('authorization');
    expect(auth).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/.*SignedHeaders=.*Signature=/
    );
  });

  it('6. throws ValidationError and does not call fetch when subject is missing', async () => {
    const email = new WrapsEmail(BASE);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      email.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        html: '<p>Hi</p>',
      } as any)
    ).rejects.toThrow(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('7a. throws ValidationError for react (unsupported at edge) before any fetch', async () => {
    const email = new WrapsEmail(BASE);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      email.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        react: {},
      } as any)
    ).rejects.toThrow(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('7b. throws ValidationError for attachments (unsupported at edge) before any fetch', async () => {
    const email = new WrapsEmail(BASE);
    await expect(
      email.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        attachments: [{ filename: 'file.txt', content: 'data' }] as any,
      })
    ).rejects.toThrow(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('8. maps 4xx SES error to SESError with correct properties', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Email address is not verified' }), {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'x-amzn-ErrorType': 'MessageRejected:',
          'x-amzn-RequestId': 'req-400',
        },
      })
    );

    const email = new WrapsEmail(BASE);
    const err = await email
      .send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SESError);
    expect(err.code).toBe('MessageRejected');
    expect(err.requestId).toBe('req-400');
    expect(err.message).toContain('not verified');
    expect(err.retryable).toBe(false);
  });

  it('9. maps 429 and 503 responses to retryable SESError', async () => {
    const email = new WrapsEmail(BASE);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Too many requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'x-amzn-RequestId': 'req-429' },
      })
    );
    const err429 = await email
      .send({ from: 'a@example.com', to: 'b@example.com', subject: 'T', html: '<p>H</p>' })
      .catch((e) => e);
    expect(err429).toBeInstanceOf(SESError);
    expect(err429.retryable).toBe(true);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Service unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json', 'x-amzn-RequestId': 'req-503' },
      })
    );
    const err503 = await email
      .send({ from: 'a@example.com', to: 'b@example.com', subject: 'T', html: '<p>H</p>' })
      .catch((e) => e);
    expect(err503).toBeInstanceOf(SESError);
    expect(err503.retryable).toBe(true);
  });
});
