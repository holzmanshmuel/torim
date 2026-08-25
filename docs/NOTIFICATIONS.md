# Notifications

**Torim ships with no messaging provider and no account with anybody.**

A fresh clone sends nothing. There is no phone number, no endpoint and no API key
anywhere in this repository, and there never will be. A deployment that wants automated
messages chooses a transport in its own environment, with its own credentials. A fork
that already pays for a WhatsApp or SMS provider writes a small adapter for it — that is
what this document is for, and it should take about twenty minutes.

If you only want the appointment book to work, stop reading after
[Owner-initiated messaging](#owner-initiated-messaging-the-default). That path needs no
provider, no key, and no configuration at all.

---

## Contents

- [The two ways a customer hears from a business](#the-two-ways-a-customer-hears-from-a-business)
- [Owner-initiated messaging: the default](#owner-initiated-messaging-the-default)
- [How an automated message flows](#how-an-automated-message-flows)
- [The `MessageTransport` contract](#the-messagetransport-contract)
- [Outcomes: sent, failed, skipped](#outcomes-sent-failed-skipped)
- [A complete worked example](#a-complete-worked-example)
- [Registering and selecting it](#registering-and-selecting-it)
- [The ops endpoints: draining the queue from outside](#the-ops-endpoints-draining-the-queue-from-outside)
- [What v1 deliberately does not do](#what-v1-deliberately-does-not-do)
- [Customer email addresses](#customer-email-addresses)
- [Checklist for a new adapter](#checklist-for-a-new-adapter)

---

## The two ways a customer hears from a business

| | Owner-initiated | Automated |
|---|---|---|
| What it is | A `wa.me` link the owner taps | A transport this deployment configured |
| Setup | None | `TORIM_TRANSPORT` plus that transport's own credentials |
| Cost | Nothing | Whatever the deployment's provider charges |
| Who sends | The owner, from her own device, from her own account | The server |
| Available in a fresh clone | Yes | No — nothing is configured |

The first is the default and always works. The second is opt-in, per deployment, and is
the only thing that needs anything in this document.

---

## Owner-initiated messaging: the default

Torim composes the message text and hands the owner a link. Tapping it opens WhatsApp on
her phone or desktop with the text already filled in, and she presses send herself.

That is `https://wa.me/<number>?text=<message>` — built by `waMeLink()` in
`src/lib/phone.ts`, rendered by `OpenWhatsApp` (`src/app/components/OpenWhatsApp.tsx`),
and composed for each booking by `WhatsAppComposer` in the admin app.

Three properties are worth being precise about, because they are the reason this path
costs nothing and requires no account:

1. **A `wa.me` link carries no sender identity.** The URL contains the *recipient's*
   number and the message text. Nothing else. It opens whatever WhatsApp account happens
   to be signed in on the device doing the tapping — the owner's own. There is no
   sender field to set, so no business number, no API number and no key is embedded
   anywhere in this app, in this repository, or in a deployment's configuration.
2. **Nothing leaves the device until she presses send.** The link opens a compose screen.
   Torim never sees whether it was sent, and does not claim to.
3. **It is a normal WhatsApp message from a person**, not a template message from a
   business API, so it is not subject to a provider's template approval, session windows
   or per-message pricing.

The owner's *own* WhatsApp number (`businesses.owner_whatsapp_phone`, set in Settings) is
used for the opposite direction only — the "Message the business" button on a customer's
confirmation screen. It is a number she chose to publish to her own customers.

> The `window.open` call in `OpenWhatsApp` is synchronous and first in the click handler,
> deliberately. iOS Safari silently blocks a popup opened after an `await` — no error, no
> dialog. Do not move it.

---

## How an automated message flows

```
booking created / cancelled / moved
            │
            ▼
  src/lib/notify/hooks.ts          afterBookingCreated · afterBookingCancelled
            │                      afterBookingRescheduled
            │  asks the configured transport which channels it can deliver
            │  → no transport (the default) → nothing is queued, and we stop here
            ▼
  src/lib/notify/schedule.ts       one row per channel for the immediate message,
            │                      plus a reminder row if reminder_lead_min is set
            ▼
  torim.notifications              status = 'queued', send_after = when it is due
            │
            ├──────────────► POST /api/ops/notifications/drain
            │                the configured transport sends it
            │                MessageTransport.send() → sent | failed | skipped
            │
            └──────────────► GET /api/ops/notifications  →  you send it
                             POST /api/ops/notifications/result  →  you report back
```

Nothing drains the queue by itself. Torim has no scheduler: something outside — a cron
job, n8n, a timer — calls one of those endpoints. A deployment that never calls either
simply accumulates rows, and with the default `none` transport it never even does that.


Four things about this shape matter:

- **The hooks run after the booking transaction has committed, and never throw.** A
  messaging problem must not fail a booking. `hooks.ts` logs and swallows; the product is
  designed to work with no transport at all.
- **Nothing is queued for a channel no configured transport claims.** A deployment with
  only email never accumulates a backlog of undeliverable WhatsApp rows, and a deployment
  with no transport queues nothing whatsoever.
- **Idempotency is a database constraint, not a convention.**
  `UNIQUE (booking_id, kind, channel)` on `torim.notifications` means a retried request, a
  double-tap or a replayed webhook cannot produce a second confirmation to a real person.
  `enqueue()` returns `null` rather than a new id when the row already existed.
- **Cancelling or moving a booking drops its pending rows.** `dropPendingForBooking()`
  deletes only `queued` rows, so what was already sent stays on the record as history.
  The failure this exists to prevent is the embarrassing one: a reminder the night before
  for an appointment the customer already called off.

---

## The `MessageTransport` contract

The whole contract is `src/lib/notify/types.ts`. It is three members.

```ts
export interface MessageTransport {
  readonly id: string;
  readonly channels: readonly Channel[];
  send(message: OutboundMessage): Promise<SendOutcome>;
}
```

### `id: string`

The name a deployment writes in `TORIM_TRANSPORT`. Lowercase and stable — it lives in
someone's configuration file, so renaming it is a breaking change for them.
`registerTransport()` lowercases and trims it, and refuses to replace an id that is
already taken: silently shadowing `smtp` with something else would make a deployment's own
config lie about what it is doing.

### `channels: readonly Channel[]`

`Channel` is `'email' | 'whatsapp' | 'sms'`. This is what the transport can *actually*
deliver, and it is read before anything is queued rather than after. Declare only what
you have really wired up. An adapter that claims `'sms'` it cannot send turns every SMS
row into a permanent failure instead of never creating one.

The built-in `none` transport declares `[]`, which is what makes "queue nothing at all"
fall out of the same code path as everything else.

### `send(message): Promise<SendOutcome>`

Called once per queued row. It receives an `OutboundMessage`:

| Field | Type | What it is |
|---|---|---|
| `id` | `string` | The `torim.notifications` row id. Echo it back when reporting the outcome; it is how the queue knows which row you just handled. |
| `businessId` | `string` | The tenant. Useful if your provider has per-business sub-accounts or sender ids. |
| `kind` | `'booking_confirmed' \| 'booking_cancelled' \| 'reminder'` | Which message this is. Map it to your provider's template names if it has any. |
| `channel` | `'email' \| 'whatsapp' \| 'sms'` | Which of your declared channels this row is for. Check it — a multi-channel adapter is dispatched on this. |
| `locale` | `'en' \| 'he'` | The business's language. The body is already in it; you need this only to pick a provider-side template. |
| `to` | `{ name, phone, email }` | The recipient. `phone` is always E.164. **`email` is `null` unless the business asked its customers for one** — see [Customer email addresses](#customer-email-addresses). |
| `subject` | `string` | Rendered subject. Channels without subjects may ignore it. |
| `body` | `string` | Rendered plain-text body, already localised. For most adapters this is the whole job. |
| `data` | `Record<string, unknown>` | The same facts as structured data, so an adapter that renders its own HTML email or fills a WhatsApp template does not have to parse `body` back apart. |

`send` should not throw. Catch your own errors and return `{ status: 'failed', error }` —
the error string is stored on the row (truncated to 2000 characters) and is the only
thing anyone will have to debug with later, so make it say what actually went wrong.

---

## Outcomes: sent, failed, skipped

```ts
type SendOutcome =
  | { status: 'sent' }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string };
```

**`failed` means "try again later".** The network was down, the provider returned a 500,
the token expired. `markFailed()` records the error and increments `attempts`.

**`skipped` means "this was never sendable".** It is a real outcome, not a soft failure,
and it is the distinction most likely to be got wrong.

A booking whose customer has no email address, on a deployment whose only transport is
email, will never become sendable no matter how many times it is retried. Recording that
as `failed` invites something — a person, or a future retry loop — to keep trying
forever. `markSkipped()` therefore **does not increment `attempts`**, because an attempt
counter exists to decide whether to try again, and there is nothing here to try.

Return `skipped` when:

- the recipient has no address on the channel you deliver (`to.email` is `null`);
- the row is for a channel you declared but cannot serve for this particular business;
- this deployment has no transport at all — which is what the built-in `none` returns for
  everything, so the reason nothing was sent is written on the row rather than inferred
  from silence.

Return `failed` when a retry might plausibly succeed. And note the one case that looks
transient but is not: `smtp.ts` returns `failed` for a missing `SMTP_URL`, because a
person needs to see that and fix it, but it returns `skipped` for a recipient with no
email address. Misconfiguration is loud; nothing-to-do is quiet.

---

## A complete worked example

Here is an entire adapter for a generic HTTP messaging API — the shape most WhatsApp and
SMS providers expose: `POST` some JSON with a recipient and a body, authenticate with a
bearer token, get JSON back. Copy it, change the request and response shapes to match
whatever you actually use, and you are done.

Nothing about any specific provider appears here, and nothing about yours should ever be
committed to a fork you intend to share upstream: the endpoint and the key come from the
environment.

**`src/lib/notify/transports/http.ts`**

```ts
/**
 * A generic HTTP messaging provider.
 *
 * Torim has no account with anybody: the endpoint, the key and the sender id all come
 * from this deployment's own environment. Nothing provider-specific is hard-coded.
 *
 *   TORIM_HTTP_ENDPOINT   e.g. https://api.example.net/v1/messages
 *   TORIM_HTTP_TOKEN      bearer token
 *   TORIM_HTTP_SENDER     optional — the sender id this account is allowed to use
 */
import type { Channel, MessageTransport, OutboundMessage, SendOutcome } from '../types';

/** How long we wait before deciding the provider is not going to answer. */
const TIMEOUT_MS = 10_000;

type Config = { endpoint: string; token: string; sender: string | null };

/**
 * Read config at send time rather than at import time, so importing this module can
 * never throw and a deployment that registers it but does not select it costs nothing.
 */
function readConfig(): Config | null {
  const endpoint = process.env.TORIM_HTTP_ENDPOINT?.trim();
  const token = process.env.TORIM_HTTP_TOKEN?.trim();
  if (!endpoint || !token) return null;
  return { endpoint, token, sender: process.env.TORIM_HTTP_SENDER?.trim() || null };
}

/** Whatever your provider calls its channels. Keep the mapping in one place. */
const CHANNEL_NAMES: Record<Channel, string> = {
  whatsapp: 'whatsapp',
  sms: 'sms',
  email: 'email',
};

export const httpTransport: MessageTransport = {
  id: 'http',

  // Declare only what you have actually wired up and tested. A channel claimed here is
  // a channel Torim will queue rows for.
  channels: ['whatsapp', 'sms'],

  async send(message: OutboundMessage): Promise<SendOutcome> {
    const config = readConfig();

    // Misconfiguration, not a transient failure: retrying will not conjure a token.
    // Loud, because a person has to go and fix it.
    if (!config) {
      return {
        status: 'failed',
        error: 'TORIM_TRANSPORT is "http" but TORIM_HTTP_ENDPOINT and/or TORIM_HTTP_TOKEN are not set.',
      };
    }

    // Never sendable, so never retryable — `skipped`, not `failed`.
    if (message.channel === 'email') {
      return { status: 'skipped', reason: 'http does not deliver email.' };
    }
    if (!message.to.phone) {
      return { status: 'skipped', reason: 'Recipient has no phone number.' };
    }

    // Do not let one unresponsive provider hold a queue drain open indefinitely.
    const abort = AbortSignal.timeout(TIMEOUT_MS);

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        signal: abort,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.token}`,
          // Many providers de-duplicate on a client-supplied key. The notification row
          // id is already unique per (booking, kind, channel), so it is exactly the
          // right value: a re-drain of the same row cannot become a second message to
          // a real person.
          'idempotency-key': message.id,
        },
        body: JSON.stringify({
          channel: CHANNEL_NAMES[message.channel],
          to: message.to.phone,
          from: config.sender,
          text: message.body,
          // `data` carries the same facts as structured values, for providers whose
          // templates take variables rather than a finished string.
          metadata: {
            kind: message.kind,
            locale: message.locale,
            businessId: message.businessId,
            ...message.data,
          },
        }),
      });

      if (!response.ok) {
        // Read the body: a provider's error text is the only clue anyone will get from
        // `notifications.last_error` at 2am. Cap it — the column stores 2000 chars.
        const detail = (await response.text().catch(() => '')).slice(0, 500);

        // 4xx is our request being wrong and will be wrong again next time; 429 and 5xx
        // are worth another go. Both are still `failed` — Torim v1 has no retry loop —
        // but the wording tells whoever reads the row which one they are looking at.
        const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
        return {
          status: 'failed',
          error: `${permanent ? 'Rejected' : 'Provider error'} ${response.status}: ${detail}`,
        };
      }

      return { status: 'sent' };
    } catch (error) {
      // Timeouts and DNS failures land here. Never let this throw out of `send`.
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
```

That is the whole adapter. Compare it with `src/lib/notify/transports/smtp.ts`, which is
the in-repo reference and follows exactly the same shape for email.

---

## Registering and selecting it

Registration has to happen once, at startup, before anything resolves a transport. In
Next.js that is `instrumentation.ts` at the root of `src/`, whose `register()` runs once
per server instance and must finish before the server takes requests.

**`src/instrumentation.ts` already exists in this repo.** It is Torim's startup-check
file — read it before you edit it. As shipped it registers no transport of its own; what
it does is validate the transport configuration at boot:

- it calls `resolveTransport()`, which **throws** on an unrecognised `TORIM_TRANSPORT`,
  and deliberately does not catch it;
- it then refuses to start if `TORIM_TRANSPORT=smtp` while `SMTP_URL` is empty.

That file is what makes "an unrecognised value fails loudly" true. Without it the throw
would happen far later, inside `configuredChannels()` in `src/lib/notify/hooks.ts`, which
catches it and queues nothing — silently, in the middle of a customer's booking, which is
precisely the failure the loudness is meant to prevent.

Your adapter goes into the same `register()`, at the placeholder comment, **before**
anything resolves a transport — so above the `resolveTransport()` call, or the boot check
will reject your own transport id as unknown:

```ts
export async function register(): Promise<void> {
  // Only the Node.js runtime; the edge runtime has neither the env nor the transports.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // ── your adapter, registered before anything resolves one ──
  const { registerTransport } = await import('@/lib/notify/registry');
  const { httpTransport } = await import('@/lib/notify/transports/http');
  registerTransport(httpTransport);

  // ── then the existing checks, unchanged ──
  const { resolveTransport } = await import('@/lib/notify/registry');
  const transport = resolveTransport();
  // ...
}
```

The dynamic `import()` is not decoration: `register()` runs in every runtime, and a
transport that touches Node APIs must not be pulled into the edge bundle. That is also
why the `NEXT_RUNTIME` guard comes first.

Then select it, in your deployment's own environment:

```bash
TORIM_TRANSPORT=http
TORIM_HTTP_ENDPOINT=https://api.example.net/v1/messages
TORIM_HTTP_TOKEN=...
```

**`TORIM_TRANSPORT` selects exactly one transport.** Unset or `none` is the default and
sends nothing. `smtp` is the other built-in. Anything else must have been registered
first.

An unrecognised value **throws** rather than falling back to `none`:

```
Unknown TORIM_TRANSPORT "htpp". Available: none, smtp. To add your own,
call registerTransport() — see docs/NOTIFICATIONS.md.
```

That is deliberate. A deployment that believes it configured messaging and quietly sends
none of it is worse than one that refuses to start, because nobody finds out until a
customer says they never heard anything.

`availableTransportIds()` returns what is registered, which is what that error message
lists. Note that it lists what is registered **at the moment it is called** — if your
`registerTransport()` call ends up after the `resolveTransport()` check, your transport
will not be in that list and the error message will not mention it.

`src/lib/notify/transports/http.ts` is the worked example above; it is **not** in this
repo, because Torim ships with no messaging provider. `src/lib/notify/transports/smtp.ts`
and `none.ts` are the two that are.

---

## The ops endpoints: draining the queue from outside

Nothing drains the queue on its own. Torim has no scheduler and no background worker —
something outside has to say "go", and there are two ways to do that.

All three endpoints are gated by a bearer token, `OPS_TOKEN`: a server-to-server secret
that never reaches a browser and is never user-facing. Send it as
`Authorization: Bearer …`, never in a query string — a token in a URL ends up in access
logs, proxies and browser history. Leave `OPS_TOKEN` unset and the endpoints stay closed,
which is the default; the product works without them.

### Push — Torim sends, through the configured transport

```
POST /api/ops/notifications/drain
Authorization: Bearer $OPS_TOKEN
```

Sends everything due through whatever `TORIM_TRANSPORT` names, and returns a summary:

```json
{ "transport": "smtp", "considered": 12, "sent": 11, "failed": 0, "skipped": 1 }
```

This is how the built-in SMTP adapter actually runs: something on a timer calls it. With
the default `none` transport it marks everything skipped, which is correct and costs
nothing — so a deployment that has not configured messaging can call this on a schedule
forever and no customer hears anything.

### Pull — something else sends, and reports back

For a deployment whose messaging already lives elsewhere. List what is due:

```
GET /api/ops/notifications?limit=50
Authorization: Bearer $OPS_TOKEN
```

```json
{
  "notifications": [
    {
      "id": "…", "businessId": "…", "businessSlug": "bella-salon", "bookingId": "…",
      "kind": "reminder", "channel": "whatsapp", "locale": "he",
      "sendAfter": "2026-08-27T06:00:00.000Z", "attempts": 0
    }
  ]
}
```

Send it with your own provider and your own credentials, then report what happened:

```
POST /api/ops/notifications/result
Authorization: Bearer $OPS_TOKEN

{ "id": "…", "businessId": "…", "transport": "my-worker", "status": "sent" }
```

`status` is `sent`, `failed` or `skipped` and means exactly what it means above; a
`failed` result must carry an `error`, and a `skipped` one should carry a `reason`.

Note that the result call names the **business** as well as the notification. Marking
happens inside that tenant's scope, so row-level security refuses an id belonging to
anyone else: guessing a notification id is not enough, you would have to also know which
tenant it is in — and even then you could only touch that tenant's rows.

If you already own an automation stack, the pull model is usually less work than writing
an adapter.

---

## What v1 deliberately does not do

Torim v1 has **no retries, no exponential backoff, no quiet hours, no debouncing and no
per-customer rate caps.** A transport that wants any of them implements them itself,
inside its own `send()`, or the external system draining the ops endpoints does.

This is a decision, not an omission.

The predecessor to this project built all of it — a retry ladder with jitter, a quiet-hours
window, a debounce so a customer who rescheduled twice in a minute got one message, and a
per-customer daily cap. Every piece was tested. None of it had ever delivered a message to
a real person, because no transport existed yet. It was deleted the day before launch,
along with the bugs nobody had found in it, because there was no way to know which of its
behaviours were right.

So: the queue records what is due and what happened. Anything cleverer belongs in the
layer that actually knows a provider's rate limits, its retry semantics and whether it
already de-duplicates — which is your adapter, not this repository.

Two things v1 *does* guarantee, because they are database properties rather than policy:

- **No duplicate message per (booking, kind, channel)**, enforced by a UNIQUE constraint.
- **No message for a booking that was cancelled or moved before it came due**, because
  the pending rows are deleted at the moment the booking changes.

---

## Customer email addresses

`businesses.ask_customer_email` is a per-business boolean, **`false` by default**.

Phone is the customer's identity in Torim, and the booking form asks for nothing else
unless the owner turns this on in Settings. When she does, the form shows an *optional*
email field and the collection notice beside the submit button changes to name it.
Nothing is pre-ticked, and a customer who leaves it blank books normally.

For a transport this means: **`message.to.email` is `null` most of the time.** An
email-only adapter must handle that, and the right outcome is `skipped` — the address was
never there to send to, and no number of retries will produce one.

`businesses.reminder_lead_min` is a nullable integer, in minutes. `NULL` means this
business does not want reminders *at all*, which is different from `0` ("at the
appointment time"). A `NOT NULL DEFAULT 0` could not express both, which is why the column
is nullable and the Settings screen offers reminders as an explicit on/off with the lead
time beside it.

---

## Checklist for a new adapter

- [ ] `id` is lowercase, stable, and not one of the built-ins (`none`, `smtp`).
- [ ] `channels` lists only what you have actually wired up and tested.
- [ ] Credentials are read from `process.env` at send time, and no default host, key,
      number or endpoint is committed.
- [ ] `send()` never throws — every path returns a `SendOutcome`.
- [ ] Missing configuration returns `failed` with a message naming the variable.
- [ ] A recipient with no address on your channel returns `skipped`, not `failed`.
- [ ] A channel you cannot serve returns `skipped` naming the channel.
- [ ] Network calls have a timeout.
- [ ] Error strings say what went wrong; they are all anyone will have later.
- [ ] `registerTransport()` is called from the existing `register()` in
      `src/instrumentation.ts`, **above** that file's `resolveTransport()` boot check —
      below it, the check rejects your own transport id as unknown and the app refuses
      to start.
- [ ] The deployment's `TORIM_TRANSPORT` names your `id`, and the provider's own
      variables are documented in your fork's `.env.example`.
