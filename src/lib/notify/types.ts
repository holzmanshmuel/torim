/**
 * The messaging contract.
 *
 * Torim ships with no messaging provider and no account with anybody. A deployment
 * chooses a transport in its own env and supplies its own credentials; a fork writes an
 * adapter for whatever it already uses. Nothing about any specific provider — no number,
 * no endpoint, no key — belongs in this repo.
 *
 * See docs/NOTIFICATIONS.md for how to write one.
 */
import type { Lang } from '../i18n';

export type NotificationKind = 'booking_confirmed' | 'booking_cancelled' | 'reminder';

export type Channel = 'email' | 'whatsapp' | 'sms';

/** Who the message is for. `email` is null unless the business asks customers for one. */
export type Recipient = {
  name: string;
  phone: string;
  email: string | null;
};

export type OutboundMessage = {
  /** The notification row's id. Echo it back when reporting the outcome. */
  id: string;
  businessId: string;
  kind: NotificationKind;
  channel: Channel;
  locale: Lang;
  to: Recipient;
  /** Rendered subject. Channels without subjects may ignore it. */
  subject: string;
  /** Rendered plain-text body, already localized. */
  body: string;
  /**
   * The same facts as structured data, so a transport that wants to render its own
   * template — an HTML email, a WhatsApp template message — does not have to parse
   * `body` back apart.
   */
  data: Record<string, unknown>;
};

/**
 * `skipped` is a real outcome, not a soft failure.
 *
 * A booking whose customer has no email address, on a deployment whose only transport is
 * email, was never sendable. Recording that as failed invites retrying something that
 * can never succeed.
 */
export type SendOutcome =
  | { status: 'sent' }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string };

export interface MessageTransport {
  /** Selected by `TORIM_TRANSPORT`. Lowercase, stable — it is written in config. */
  readonly id: string;
  /**
   * Channels this transport can actually deliver. Nothing is ever queued for a channel
   * no configured transport claims, so a deployment with only email never accumulates
   * a backlog of undeliverable WhatsApp messages.
   */
  readonly channels: readonly Channel[];
  send(message: OutboundMessage): Promise<SendOutcome>;
}
