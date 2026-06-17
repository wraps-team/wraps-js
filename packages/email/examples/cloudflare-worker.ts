import { SESError, ValidationError, WrapsEmail } from '@wraps.dev/email/workers';

type Env = {
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  FROM_EMAIL: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const email = new WrapsEmail({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
    try {
      const { to, subject, html } = await request.json<{
        to: string;
        subject: string;
        html: string;
      }>();
      const result = await email.send({ from: env.FROM_EMAIL, to, subject, html });
      return Response.json({ success: true, messageId: result.messageId });
    } catch (error) {
      if (error instanceof ValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof SESError) {
        return Response.json(
          { error: error.message, code: error.code },
          { status: error.retryable ? 503 : 400 }
        );
      }
      throw error;
    }
  },
};
