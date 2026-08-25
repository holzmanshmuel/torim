# Shared component kit

Generic, accessible UI primitives for Torim. Import everything from one path:

```ts
import { Button, Field, useAsyncAction, /* ... */ } from '@/app/components';
```

None of these build a screen - they're building blocks for the booking flow and
admin dashboard lanes. All support LTR and RTL (the app sets `dir` on `<html>`;
most of these primitives lean on that plus Tailwind's logical-property utilities
rather than taking a `dir`/`lang` prop themselves - see "i18n" below for the two
that do need one).

## Design tokens

Colors/radii come from `src/app/globals.css` via Tailwind's `@theme inline` -
`bg-blue`, `text-ink`, `border-line`, `rounded-md`, etc. One token pair was added
for this kit: **`danger`/`danger-soft`** (a desaturated red, same two-step shape as
the existing `ok`/`warn` pair) - there was no destructive/error color yet, and
`Button`'s `danger` variant plus `StatusPill`'s `no_show` needed one rather than a
hardcoded hex. Blue still does the primary-action work; lime is not used in any of
these primitives (per the house design system - "at most one spark per screen").

## Components

### `Button`
```ts
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; // default 'primary'
  size?: 'sm' | 'md' | 'lg';                               // default 'md'
  loading?: boolean;                                       // default false
  children: ReactNode;
};
```
A real `<button>` (forwards `ref`). `md` is 44px tall - don't shrink it, that's the
accessible touch-target minimum. `loading` shows a spinner, sets `aria-busy`, and
disables the button; it does **not** change the label - swap `children` yourself if
you want the text to change too (e.g. `t('save.saving')`). Use `danger` for
destructive actions (also the default inside `ConfirmDialog`).

### `Card`
```ts
type CardProps = {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  padded?: boolean; // default true - set false for edge-to-edge content (tables)
  className?: string;
};
```
Surface, soft border, 14px radius (`rounded-md`). Pure presentation, safe to use
from a Server Component.

### `Field`
```ts
type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  id?: string; // auto-generated via useId() if omitted
  containerClassName?: string;
};
```
Label + input + hint + error, wired via `htmlFor`/`aria-describedby`/`aria-invalid`.
Forwards `ref` to the `<input>`. The input is 16px+ (inherited globally from
`globals.css`) so iOS Safari never force-zooms on focus - don't shrink its font size
below `text-base` in `className`.

### `Select`
```ts
type SelectOption = { value: string; label: string; disabled?: boolean };

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
  options: SelectOption[];
  placeholder?: string; // rendered as a disabled first option
  containerClassName?: string;
};
```
Same wrapper contract as `Field`, for a native `<select>`. Forwards `ref`.

### `StatusPill`
```ts
type StatusPillVariant =
  | 'confirmed' | 'pending' | 'cancelled' | 'no_show'
  | 'neutral' | 'ok' | 'warn';

type StatusPillProps = {
  variant: StatusPillVariant;
  children: ReactNode; // already-localized label text
  className?: string;
};
```
Small uppercase mono pill (`.mono-label`). Color mapping - domain statuses alias
onto the generic palette families:

| variant                | looks like |
|-------------------------|------------|
| `confirmed`, `ok`       | green (`ok`) |
| `pending`, `warn`       | amber (`warn`) |
| `cancelled`, `neutral`  | grey (muted - "inactive", not "bad") |
| `no_show`               | red (`danger` - the one genuinely negative outcome) |

### `Sheet`
```ts
type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  closeLabel: string; // required - accessible label for the (X) button
  children: ReactNode;
  footer?: ReactNode;  // gets safe-area bottom padding (see below)
  className?: string;
};
```
Bottom sheet on mobile, centered dialog from `sm:` up. `aria-modal="true"`, traps
focus (Tab/Shift+Tab wrap inside the panel), closes on `Escape` and backdrop click,
restores focus to whatever triggered it on close, and locks background scroll while
open. **Put your primary action in `footer`** - that slot carries `.pb-safe` so it
always clears the iOS home-indicator zone; putting it in `children` instead risks
it landing under the home indicator on notch-less-bezel iPhones.

### `EmptyState`
```ts
type EmptyStateProps = {
  icon?: ReactNode;  // decorative, rendered aria-hidden
  title?: string;
  message: string;
  action: ReactNode; // required - never a dead end, pass a wired-up Button/Link
  className?: string;
};
```

### `ErrorState`
```ts
type ErrorStateProps = {
  message: string;       // already localized by the caller
  onRetry?: () => void;
  retryLabel?: string;   // defaults to t('common.tryAgain') if `t` given, else "Try again"
  t?: (key: string) => string; // getT(lang) - only used for the default retry label
  className?: string;
};
```

### `Spinner`
```ts
type SpinnerProps = {
  size?: 'sm' | 'md' | 'lg'; // default 'md'
  className?: string;
  label?: string; // pass only when the spinner is the sole busy indicator
};
```
Color follows `currentColor` - drop it inside colored text and it matches with no
extra prop (this is how `Button`'s `loading` spinner gets the right color for free).

### `Skeleton`
```ts
type SkeletonProps = {
  className?: string; // size it yourself, e.g. "h-4 w-32"
  label?: string;      // put this on exactly one Skeleton per loading group
};
```

### `ConfirmDialog`
```ts
type ConfirmDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title?: ReactNode;
  message: ReactNode;   // name the specific thing being destroyed, not "Are you sure?"
  confirmLabel: string;
  cancelLabel: string;
  closeLabel: string;
  confirmPending?: boolean;         // wire to a useAsyncAction's `pending`
  confirmVariant?: ButtonProps['variant']; // default 'danger'
};
```
`Sheet`, pre-wired for a destructive confirmation. If `message` embeds a date,
time, or price, wrap that value with `isolate()` from `@/lib/bidi` before passing
it in - this component renders it as-is.

## The two that matter most

### `useAsyncAction`
```ts
function useAsyncAction<Args extends unknown[] = [], T = void>(
  action: (...args: Args) => Promise<T>,
  options?: { lang?: Lang },
): {
  run: (...args: Args) => Promise<T | undefined>;
  pending: boolean;
  error: string | null;
  reset: () => void;
};
```
Wrap any async action in this and "stuck on one moment forever" becomes
structurally impossible: `pending` always returns to `false` in a `finally`
(success, failure, *or* unmount), a thrown value always becomes a localized string
in `error`, a second `run()` while one is in flight is ignored, and no state is set
after unmount. `run`'s identity follows `action`/`lang` like any `useCallback` -
pass a stable `action` if you need `run` itself to stay referentially stable.

The same guard/formatting logic also exists framework-free and directly unit
tested in `asyncActionCore.ts` (`createAsyncActionCore`, `toErrorMessage`) - see
`asyncActionCore.test.ts` for the proofs that `pending` clears on throw and that a
concurrent `run()` is ignored. `useAsyncAction` re-implements the same guarantees
inline rather than delegating to it, because this repo's `react-hooks/refs` lint
rule forbids handing a ref-reading closure to another function during render.

### `OpenWhatsApp`
```ts
type OpenWhatsAppProps = {
  phone: string;   // already E.164 - see normalisePhone() in @/lib/phone
  message: string;
  label: string;
  lang: Lang;
  onOpened?: () => Promise<void>; // optional follow-up call, e.g. "mark as notified"
  variant?: ButtonProps['variant']; // default 'secondary'
  size?: ButtonProps['size'];       // default 'md'
  disabled?: boolean;
  className?: string;
};
```
Opens a wa.me deep link. **`window.open` runs synchronously in the click handler,
before anything else** - iOS Safari silently blocks a popup opened after an
`await` (no error, no dialog). That exact refactor broke the "notify the client"
button in the predecessor project: the customer was never messaged and the owner
believed she had. `onOpened` (e.g. a "mark as notified" write) runs *after* the tab
is already open, via `useAsyncAction`, so its own pending/error state can't stick
either - do not turn the click handler `async` and move `window.open` after it.

## i18n

Everything except `useAsyncAction` and `OpenWhatsApp` takes plain, already-localized
strings as props - no component reaches into the dictionary itself. `useAsyncAction`
and `OpenWhatsApp` take an optional/required `lang` only to resolve the one generic
fallback string (`error.title`) they might need to show without the caller having
supplied one. `ErrorState` optionally accepts `t` for the same reason (default retry
label). If a message you pass in embeds a date range, time range, price, or phone
number, wrap that value with `isolate()` from `@/lib/bidi` yourself before handing
it to `ConfirmDialog`, `ErrorState`, etc. - these primitives render text as given.
