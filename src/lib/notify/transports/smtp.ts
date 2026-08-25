/**
 * Email over SMTP.
 *
 * Ships in-repo because SMTP is the one transport every self-hoster can already reach —
 * their own mail server, their own provider, their own domain. Torim has no account with
 * anyone and no default host: `SMTP_URL` and `SMTP_FROM` come from the deployment.
 *
 * Also the reference for what an adapter looks like. A fork wanting Twilio, the WhatsApp
 * Cloud API or Evolution writes a file this shape and registers it.
 */
import type { MessageTransport, OutboundMessage, SendOutcome } from '../types';

/**
 * nodemailer is imported lazily, so a deployment running the default `none` transport
 * never loads it — and a build that never sends email never pays for it.
 */
async function getTransporter(url: string) {
  const nodemailer = await import('nodemailer');
  return nodemailer.createTransport(url);
}

export const smtpTransport: MessageTransport = {
  id: 'smtp',
  channels: ['email'],

  async send(message: OutboundMessage): Promise<SendOutcome> {
    const url = process.env.SMTP_URL?.trim();
    const from = process.env.SMTP_FROM?.trim();

    // Misconfiguration, not a transient failure: retrying will not fix a missing URL.
    if (!url || !from) {
      return {
        status: 'failed',
        error: 'TORIM_TRANSPORT is "smtp" but SMTP_URL and/or SMTP_FROM are not set.',
      };
    }

    // Never sendable, so never retryable. The business may simply not ask customers for
    // an email address — that is the default.
    if (!message.to.email) {
      return { status: 'skipped', reason: 'Recipient has no email address.' };
    }
    if (message.channel !== 'email') {
      return { status: 'skipped', reason: `smtp cannot deliver on "${message.channel}".` };
    }

    try {
      const transporter = await getTransporter(url);
      await transporter.sendMail({
        from,
        to: message.to.email,
        subject: message.subject,
        text: message.body,
      });
      return { status: 'sent' };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
