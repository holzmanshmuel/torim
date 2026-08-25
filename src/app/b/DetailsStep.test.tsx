// @vitest-environment jsdom
/**
 * Render tests for the details step.
 *
 * Two properties here are honesty properties, not cosmetics, and both are invisible in a
 * type check:
 *
 *  1. When the business has not asked for an email address, there is no email field —
 *     not a hidden one, not a disabled one.
 *  2. The collection notice beside the submit button names exactly the fields the form
 *     has. A notice that lists an email box the customer cannot see is wrong; so is one
 *     that omits a box they just typed into.
 *
 * There is also a third thing asserted by its absence: nothing on this screen tells a
 * customer they will receive a confirmation or a reminder. This layer cannot see whether
 * the deployment has a messaging transport at all, and the predecessor project told
 * customers about reminders that did not exist.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getT } from '@/lib/i18n';
import { CollectionNotice, DetailsStep } from './DetailsStep';
import { bookingDictionary } from './dictionary';

afterEach(cleanup);

const t = getT('en', bookingDictionary);

function renderStep(asksEmail: boolean) {
  return render(
    <DetailsStep
      t={t}
      hasDefaultCallingCode
      asksEmail={asksEmail}
      name=""
      phone=""
      email=""
      note=""
      nameError={null}
      phoneError={null}
      emailError={null}
      noteError={null}
      onNameChange={() => {}}
      onPhoneChange={() => {}}
      onEmailChange={() => {}}
      onNoteChange={() => {}}
      onSubmit={() => {}}
      disabled={false}
    />,
  );
}

describe('DetailsStep', () => {
  it('asks for name and phone and nothing else by default', () => {
    renderStep(false);

    expect(screen.getByLabelText(/Full name/)).toBeTruthy();
    expect(screen.getByLabelText(/Mobile number/)).toBeTruthy();
    expect(screen.queryByLabelText(/Email address/)).toBeNull();
  });

  it('adds an optional email field when the business asked for one', () => {
    renderStep(true);

    const email = screen.getByLabelText(/Email address/) as HTMLInputElement;
    expect(email.type).toBe('email');
    // Optional means optional: no required attribute, and the label says so.
    expect(email.required).toBe(false);
    expect(screen.getByText(/Email address \(Optional\)/)).toBeTruthy();
  });

  it('never pre-ticks a consent box, because there is no box to tick', () => {
    const { container } = renderStep(true);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });
});

describe('CollectionNotice', () => {
  it('names name and phone only when there is no email field', () => {
    render(<CollectionNotice t={t} asksEmail={false} />);

    const notice = screen.getByText(/We collect your name and phone number/);
    expect(notice.textContent).not.toMatch(/email/i);
  });

  it('names the email address too once the form collects one', () => {
    render(<CollectionNotice t={t} asksEmail />);

    expect(screen.getByText(/name, phone number and email address/)).toBeTruthy();
  });

  it('promises nothing about messages being sent, in either state', () => {
    // The failure this guards: a customer told to expect a confirmation or a reminder on
    // a deployment that has no transport configured — which is the default.
    for (const asksEmail of [false, true]) {
      cleanup();
      const { container } = render(<CollectionNotice t={t} asksEmail={asksEmail} />);
      expect(container.textContent).not.toMatch(/remind|confirmation email|we.ll send|send you/i);
    }
  });
});
