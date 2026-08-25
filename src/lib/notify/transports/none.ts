import type { MessageTransport } from '../types';

/**
 * The default, and the one most deployments will run.
 *
 * Torim works completely without automated messaging: the owner taps a pre-filled
 * WhatsApp link and sends from her own device. This transport exists so that path is
 * represented by an object rather than by a null every caller must remember to check —
 * and so the reason nothing was sent is recorded on the row.
 */
export const noneTransport: MessageTransport = {
  id: 'none',
  channels: [],
  async send() {
    return {
      status: 'skipped',
      reason: 'No transport configured (TORIM_TRANSPORT is unset or "none").',
    };
  },
};
