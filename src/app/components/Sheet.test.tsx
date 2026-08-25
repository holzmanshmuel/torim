// @vitest-environment jsdom
/**
 * Render tests for Sheet.
 *
 * The kit was built without a DOM available, so its focus behaviour was implemented and
 * type-checked but never actually exercised. Focus management is exactly the kind of
 * thing that looks right in source and is wrong at runtime, and it is invisible to
 * anyone not using a keyboard or a screen reader — so it gets real tests.
 */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

afterEach(cleanup);

function OpenableSheet() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Move appointment" closeLabel="Close">
        <button type="button">First inside</button>
        <button type="button">Second inside</button>
      </Sheet>
    </div>
  );
}

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    render(
      <Sheet open={false} onClose={() => {}} closeLabel="Close">
        <p>Hidden body</p>
      </Sheet>,
    );
    expect(screen.queryByText('Hidden body')).toBeNull();
  });

  it('is an accessible modal dialog when open', () => {
    render(
      <Sheet open onClose={() => {}} title="Cancel booking" closeLabel="Close">
        <p>Visible body</p>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // The title is what a screen reader announces, so it must be wired, not just drawn.
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByText('Visible body')).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} closeLabel="Close">
        <p>Body</p>
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} closeLabel="Close">
        <p>Body</p>
      </Sheet>,
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the sheet when it opens', async () => {
    const user = userEvent.setup();
    render(<OpenableSheet />);

    await user.click(screen.getByRole('button', { name: 'Open it' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  /**
   * Without this a keyboard user is dumped back at the top of the document every time a
   * sheet closes, and loses their place entirely.
   */
  it('restores focus to whatever opened it', async () => {
    const user = userEvent.setup();
    render(<OpenableSheet />);

    const trigger = screen.getByRole('button', { name: 'Open it' });
    await user.click(trigger);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Tab inside the sheet', async () => {
    const user = userEvent.setup();
    render(<OpenableSheet />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));

    const dialog = screen.getByRole('dialog');
    // Walk forward well past the number of focusable elements inside; focus must never
    // escape to the trigger behind the overlay.
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('keeps Shift+Tab inside the sheet too', async () => {
    const user = userEvent.setup();
    render(<OpenableSheet />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));

    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 8; i += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('puts the footer action where a thumb can reach it without hitting the home indicator', () => {
    render(
      <Sheet open onClose={() => {}} closeLabel="Close" footer={<button type="button">Confirm</button>}>
        <p>Body</p>
      </Sheet>,
    );
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    const footer = confirm.closest('.pb-safe');
    expect(footer).not.toBeNull();
  });
});
