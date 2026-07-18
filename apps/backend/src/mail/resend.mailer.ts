import { Injectable, Logger } from '@nestjs/common';
import { Mailer, MailMessage } from './mailer';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Sends via Resend's HTTP API.
 *
 * Deliberately no `resend` npm package: sending is a single POST, so the SDK
 * would buy us nothing but a dependency. Node 18+ has global fetch.
 */
@Injectable()
export class ResendMailer implements Mailer {
  private readonly log = new Logger(ResendMailer.name);

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    if (!res.ok) {
      // Read the body for the log — Resend explains itself well here ("domain
      // not verified", "invalid from"), and that reason is otherwise lost. It
      // stays server-side: the caller turns this into a generic user message.
      const detail = await res.text().catch(() => '<unreadable body>');
      this.log.error(`Resend rejected the message: ${res.status} ${detail}`);
      throw new Error(`Resend request failed with ${res.status}`);
    }
  }
}
