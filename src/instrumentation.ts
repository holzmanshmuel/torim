/**
 * Startup checks.
 *
 * Next calls `register()` once per server instance, before the first request is served —
 * which is the only place a configuration mistake can be reported loudly. A red-team
 * audit found that `docs/NOTIFICATIONS.md` and `.env.example` both promised a bad
 * `TORIM_TRANSPORT` would "fail loudly rather than silently sending nothing", while
 * nothing validated it at boot: `notify/hooks.ts` catches the throw and queues nothing,
 * producing exactly the silent failure the docs claimed to prevent.
 *
 * This is also where a fork registers its own message transport — see
 * docs/NOTIFICATIONS.md.
 */
export async function register(): Promise<void> {
  // Only the Node.js runtime; the edge runtime has neither the env nor the transports.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // A fork adds its own adapter here, before anything resolves one:
  //   const { registerTransport } = await import('@/lib/notify/registry');
  //   registerTransport(myTransport);

  const { resolveTransport } = await import('@/lib/notify/registry');

  // Throws on an unrecognised value, naming what is available. Deliberately not caught:
  // a deployment that believes it configured messaging and quietly sends none of it is
  // worse than one that refuses to start.
  const transport = resolveTransport();

  if (transport.id === 'smtp' && !(process.env.SMTP_URL ?? '').trim()) {
    throw new Error(
      'TORIM_TRANSPORT is "smtp" but SMTP_URL is not set. ' +
        'Set both SMTP_URL and SMTP_FROM, or leave TORIM_TRANSPORT unset to send nothing.',
    );
  }
}
