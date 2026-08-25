/**
 * Which transport this deployment uses.
 *
 * Selected by `TORIM_TRANSPORT`, defaulting to `none`. A fork adds its own adapter with
 * `registerTransport` and names it in its own env; no provider-specific code lives here.
 */
import { noneTransport } from './transports/none';
import { smtpTransport } from './transports/smtp';
import type { MessageTransport } from './types';

const BUILT_IN: readonly MessageTransport[] = [noneTransport, smtpTransport];

const registry = new Map<string, MessageTransport>(BUILT_IN.map((t) => [t.id, t]));

/**
 * Add an adapter. Call this at startup, before anything resolves a transport.
 *
 * Refuses to replace an existing id: silently shadowing `smtp` with something else would
 * make the deployment's own config lie about what it is doing.
 */
export function registerTransport(transport: MessageTransport): void {
  const id = transport.id.trim().toLowerCase();
  if (!id) throw new Error('A transport needs a non-empty id.');
  if (registry.has(id)) {
    throw new Error(`Transport "${id}" is already registered.`);
  }
  registry.set(id, transport);
}

export function availableTransportIds(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Resolve the configured transport.
 *
 * An unrecognised value throws rather than falling back to `none`. A deployment that
 * believes it configured email and quietly sends none of it is worse than one that
 * refuses to start, because nobody finds out until a customer says they never heard
 * anything.
 */
export function resolveTransport(
  env: Record<string, string | undefined> = process.env,
): MessageTransport {
  const requested = (env.TORIM_TRANSPORT ?? '').trim().toLowerCase();
  if (!requested) return noneTransport;

  const transport = registry.get(requested);
  if (!transport) {
    throw new Error(
      `Unknown TORIM_TRANSPORT "${requested}". Available: ${availableTransportIds().join(', ')}. ` +
        'To add your own, call registerTransport() — see docs/NOTIFICATIONS.md.',
    );
  }
  return transport;
}
