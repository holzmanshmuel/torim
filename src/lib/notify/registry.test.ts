/**
 * Choosing a transport.
 *
 * Torim ships with no messaging provider. A fresh clone must send nothing and require an
 * account with nobody — so the default is `none`, and it is a real transport that
 * reports why it did nothing rather than a null that callers must remember to check.
 */
import { describe, expect, it } from 'vitest';
import { availableTransportIds, registerTransport, resolveTransport } from './registry';
import type { MessageTransport, OutboundMessage } from './types';

const message = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({
  id: '00000000-0000-0000-0000-000000000001',
  businessId: '00000000-0000-0000-0000-0000000000b1',
  kind: 'booking_confirmed',
  channel: 'email',
  locale: 'en',
  to: { name: 'Ada', phone: '+15550100001', email: 'ada@example.invalid' },
  subject: 'Booked',
  body: 'You are booked.',
  data: {},
  ...over,
});

describe('resolveTransport', () => {
  it('defaults to none when nothing is configured', () => {
    expect(resolveTransport({}).id).toBe('none');
  });

  it('defaults to none for an empty or whitespace value', () => {
    expect(resolveTransport({ TORIM_TRANSPORT: '' }).id).toBe('none');
    expect(resolveTransport({ TORIM_TRANSPORT: '   ' }).id).toBe('none');
  });

  it('resolves a registered transport by id, case-insensitively', () => {
    expect(resolveTransport({ TORIM_TRANSPORT: 'smtp' }).id).toBe('smtp');
    expect(resolveTransport({ TORIM_TRANSPORT: 'SMTP' }).id).toBe('smtp');
  });

  /**
   * A typo must not silently fall back to sending nothing. A deployment that believes
   * it configured email and quietly sends none of it is worse than one that will not
   * start, because nobody finds out until a customer says they never heard anything.
   */
  it('throws on an unknown transport rather than falling back to silence', () => {
    expect(() => resolveTransport({ TORIM_TRANSPORT: 'sendgrid' })).toThrow(/sendgrid/);
    expect(() => resolveTransport({ TORIM_TRANSPORT: 'sendgrid' })).toThrow(/none, smtp/);
  });

  it('lists what is available, so the error can say', () => {
    expect(availableTransportIds()).toContain('none');
    expect(availableTransportIds()).toContain('smtp');
  });
});

describe('the none transport', () => {
  it('skips rather than fails, and says why', async () => {
    const outcome = await resolveTransport({}).send(message());
    expect(outcome.status).toBe('skipped');
    if (outcome.status === 'skipped') {
      expect(outcome.reason).toMatch(/no transport/i);
    }
  });

  it('claims no channels, so nothing is ever queued for it', () => {
    expect(resolveTransport({}).channels).toEqual([]);
  });
});

describe('registerTransport', () => {
  /**
   * The extension point. A fork adds its own adapter — Twilio, WhatsApp Cloud API,
   * Evolution, anything — and selects it by id in its own env. Nothing about the
   * provider belongs in this repo.
   */
  it('makes a fork’s own adapter selectable by id', () => {
    const sent: OutboundMessage[] = [];
    const pigeon: MessageTransport = {
      id: 'carrier-pigeon',
      channels: ['whatsapp'],
      async send(m) {
        sent.push(m);
        return { status: 'sent' };
      },
    };

    registerTransport(pigeon);
    const resolved = resolveTransport({ TORIM_TRANSPORT: 'carrier-pigeon' });

    expect(resolved.id).toBe('carrier-pigeon');
    expect(availableTransportIds()).toContain('carrier-pigeon');
  });

  it('refuses to overwrite a built-in id by accident', () => {
    const impostor: MessageTransport = {
      id: 'smtp',
      channels: ['email'],
      async send() {
        return { status: 'sent' };
      },
    };
    expect(() => registerTransport(impostor)).toThrow(/already registered/i);
  });
});
