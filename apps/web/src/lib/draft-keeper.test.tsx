import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { forgetAllDrafts, installDraftKeeper, stopDraftKeeper } from './draft-keeper.js';

/** Any form at all, written the way the screens write theirs: React holds the value. */
function SomeForm({ onSave }: { onSave: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  return (
    <main>
      <h1>Gulf Trading LLC</h1>
      <section className="card">
        <h2>A form nobody wired up</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSave();
          }}
        >
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </label>
          <button type="submit">Save</button>
        </form>
      </section>
    </main>
  );
}

describe('keeping what was typed in any form', () => {
  const ok = vi.fn(async () => new Response('{}', { status: 200 }));
  const refused = vi.fn(async () => new Response('{}', { status: 409 }));
  let answer: () => Promise<Response> = refused;

  beforeAll(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => answer()),
    );
    installDraftKeeper();
  });
  afterEach(() => cleanup());
  afterAll(() => stopDraftKeeper());

  const save = () => fetch('/api/anything', { method: 'POST' });

  it('brings back what was typed after a refused save, but never the password', async () => {
    const user = userEvent.setup();
    answer = refused;
    render(<SomeForm onSave={save} />);
    await user.type(screen.getByLabelText('Name'), 'Hamza Froock');
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    cleanup();

    render(<SomeForm onSave={save} />);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Hamza Froock'));
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(await screen.findByRole('status')).toHaveTextContent(/not save|لم يُحفظ/);
  });

  it('forgets it once the save goes through', async () => {
    const user = userEvent.setup();
    answer = refused;
    render(<SomeForm onSave={save} />);
    await user.type(screen.getByLabelText('Name'), 'Saved Co');
    answer = ok;
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ok).toHaveBeenCalled());
    cleanup();

    render(<SomeForm onSave={save} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('forgets everything on signing out', async () => {
    const user = userEvent.setup();
    answer = refused;
    render(<SomeForm onSave={save} />);
    await user.type(screen.getByLabelText('Name'), 'Left behind');
    cleanup();
    forgetAllDrafts();

    render(<SomeForm onSave={save} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });
});
