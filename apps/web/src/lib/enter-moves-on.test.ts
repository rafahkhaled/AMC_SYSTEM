import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installEnterMovesOn, stopEnterMovesOn } from './enter-moves-on.js';

function press(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('Enter in a form', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input id="name" />
        <input id="hidden" type="hidden" />
        <input id="off" disabled />
        <select id="branch"><option>Dubai</option></select>
        <textarea id="notes"></textarea>
        <input id="last" />
        <button type="submit">Save</button>
      </form>`;
    installEnterMovesOn();
  });
  afterEach(() => {
    stopEnterMovesOn();
    document.body.innerHTML = '';
  });

  it('moves to the next box, past hidden and disabled ones', () => {
    const event = press(document.getElementById('name') as Element);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('branch');
  });

  it('goes from a choice to the box after it', () => {
    press(document.getElementById('branch') as Element);
    expect(document.activeElement?.id).toBe('notes');
  });

  it('leaves a new line in a text area alone', () => {
    expect(press(document.getElementById('notes') as Element).defaultPrevented).toBe(false);
  });

  it('lets the last box save the form, as before', () => {
    expect(press(document.getElementById('last') as Element).defaultPrevented).toBe(false);
  });

  it('keeps the browser’s way with Shift', () => {
    const event = press(document.getElementById('name') as Element, { shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing while a word is being composed', () => {
    const name = document.getElementById('name') as HTMLInputElement;
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    vi.spyOn(event, 'isComposing', 'get').mockReturnValue(true);
    name.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
