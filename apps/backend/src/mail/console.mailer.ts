import { Injectable, Logger } from '@nestjs/common';
import { Mailer, MailMessage } from './mailer';

/**
 * The dev mailer: logs the message instead of sending it.
 *
 * Used whenever RESEND_API_KEY is unset, so a fresh clone can exercise the whole
 * login flow with no provider account — you read the code out of the backend log
 * and type it into the form.
 */
@Injectable()
export class ConsoleMailer implements Mailer {
  private readonly log = new Logger(ConsoleMailer.name);

  send(message: MailMessage): Promise<void> {
    // The text body carries the code, so logging it is the whole point here.
    // This is why the console mailer must never be selected in production —
    // see the factory in mail.module.ts.
    this.log.log(
      `Would send email (no RESEND_API_KEY set)\n` +
        `  to:      ${message.to}\n` +
        `  subject: ${message.subject}\n` +
        `${message.text.replace(/^/gm, '  | ')}`,
    );
    return Promise.resolve();
  }
}
