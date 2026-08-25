/**
 * Message text.
 *
 * Lives here rather than in the app's dictionaries because the ops endpoints render
 * without a request, a locale cookie or a React tree — and because `src/lib` must not
 * depend on `src/app`.
 *
 * Plain text on purpose. A transport that wants HTML, or a provider's own template
 * format, gets the same facts as structured data on the message and renders its own.
 */
import type { Lang } from '../i18n';
import type { NotificationKind } from './types';

export type MessageFacts = {
  businessName: string;
  serviceName: string;
  customerName: string;
  /** Already formatted in the business's timezone and locale. */
  when: string;
  manageUrl: string;
};

type Template = { subject: (f: MessageFacts) => string; body: (f: MessageFacts) => string };

const EN: Record<NotificationKind, Template> = {
  booking_confirmed: {
    subject: (f) => `Your appointment at ${f.businessName}`,
    body: (f) =>
      `Hi ${f.customerName},\n\n` +
      `Your ${f.serviceName} at ${f.businessName} is booked for ${f.when}.\n\n` +
      `Need to change or cancel it? Use this private link:\n${f.manageUrl}\n`,
  },
  reminder: {
    subject: (f) => `Reminder: ${f.serviceName} at ${f.businessName}`,
    body: (f) =>
      `Hi ${f.customerName},\n\n` +
      `A reminder that your ${f.serviceName} at ${f.businessName} is coming up on ${f.when}.\n\n` +
      `Need to change or cancel it? Use this private link:\n${f.manageUrl}\n`,
  },
  booking_cancelled: {
    subject: (f) => `Cancelled: your appointment at ${f.businessName}`,
    body: (f) =>
      `Hi ${f.customerName},\n\n` +
      `Your ${f.serviceName} at ${f.businessName} on ${f.when} has been cancelled.\n\n` +
      `You can book again here:\n${f.manageUrl}\n`,
  },
};

const HE: Record<NotificationKind, Template> = {
  booking_confirmed: {
    subject: (f) => `התור שלך ב${f.businessName}`,
    body: (f) =>
      `שלום ${f.customerName},\n\n` +
      `${f.serviceName} ב${f.businessName} נקבע ל-${f.when}.\n\n` +
      `צריך/ה לשנות או לבטל? הקישור הפרטי שלך:\n${f.manageUrl}\n`,
  },
  reminder: {
    subject: (f) => `תזכורת: ${f.serviceName} ב${f.businessName}`,
    body: (f) =>
      `שלום ${f.customerName},\n\n` +
      `תזכורת ש${f.serviceName} ב${f.businessName} מתקרב, ב-${f.when}.\n\n` +
      `צריך/ה לשנות או לבטל? הקישור הפרטי שלך:\n${f.manageUrl}\n`,
  },
  booking_cancelled: {
    subject: (f) => `בוטל: התור שלך ב${f.businessName}`,
    body: (f) =>
      `שלום ${f.customerName},\n\n` +
      `${f.serviceName} ב${f.businessName} בתאריך ${f.when} בוטל.\n\n` +
      `אפשר לקבוע תור חדש כאן:\n${f.manageUrl}\n`,
  },
};

const BY_LANG: Record<Lang, Record<NotificationKind, Template>> = { en: EN, he: HE };

export function renderTemplate(
  lang: Lang,
  kind: NotificationKind,
  facts: MessageFacts,
): { subject: string; body: string } {
  const template = BY_LANG[lang][kind];
  return { subject: template.subject(facts), body: template.body(facts) };
}
