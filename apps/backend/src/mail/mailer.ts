/**
 * The seam between "we decided to send an email" and "a provider sent it".
 *
 * Auth code depends on this interface only, so swapping Resend for SES later is
 * a change to `mail.module.ts` and one new file — nothing in `auth/` moves.
 */

/** One outbound message. `text` is not optional: see the note in MailMessage. */
export interface MailMessage {
  to: string;
  subject: string;
  /**
   * Plain-text body. Always send one alongside the HTML — it's what a client
   * shows in the preview line, and what a text-only reader gets.
   */
  text: string;
  html: string;
}

export interface Mailer {
  /** Deliver the message, or throw if the provider rejected it. */
  send(message: MailMessage): Promise<void>;
}

/**
 * Injection token. `Mailer` is a TypeScript interface, so it vanishes at compile
 * time and can't be used as a Nest provider token on its own.
 */
export const MAILER = Symbol('MAILER');
