import { MailMessage } from '../mailer';

/**
 * The one-time login code email.
 *
 * Styles are inline and the layout is a single centred block: mail clients strip
 * <style> blocks and mostly ignore modern CSS, so this stays deliberately plain.
 */
export function loginCodeEmail(to: string, code: string, ttlMinutes: number): MailMessage {
  return {
    to,
    // The code goes in the subject too: it's often all you need to see, right
    // from the notification, without opening anything.
    subject: `${code} is your Vorkium login code`,
    text: [
      `Your Vorkium login code is ${code}.`,
      ``,
      `It expires in ${ttlMinutes} minutes and can only be used once.`,
      ``,
      `If you didn't try to sign in, you can ignore this email — someone likely`,
      `mistyped their address, and without the code nothing happens.`,
    ].join('\n'),
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;color:#16232b">
        <p style="margin:0 0 24px;font-size:15px">Your Vorkium login code is:</p>
        <p style="margin:0 0 24px;font-size:34px;font-weight:700;letter-spacing:8px;color:#2145e6">${code}</p>
        <p style="margin:0 0 24px;font-size:14px;color:#5c6b74">
          It expires in ${ttlMinutes} minutes and can only be used once.
        </p>
        <p style="margin:0;font-size:12.5px;color:#8a99a1">
          If you didn't try to sign in, you can ignore this email — someone likely
          mistyped their address, and without the code nothing happens.
        </p>
      </div>
    `.trim(),
  };
}
