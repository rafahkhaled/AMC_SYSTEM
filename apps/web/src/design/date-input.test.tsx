import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DateInput, parseDay, showDay } from './date-input.js';

describe('reading a typed date', () => {
  it('reads the ways people write a date', () => {
    expect(parseDay('31/03/2026')).toBe('2026-03-31');
    expect(parseDay('31032026')).toBe('2026-03-31');
    expect(parseDay('1/3/2026')).toBe('2026-03-01');
    expect(parseDay('2026-03-31')).toBe('2026-03-31');
    expect(parseDay('31.03.2026')).toBe('2026-03-31');
  });

  it('takes a two-digit year as this century, not the year 0020', () => {
    expect(parseDay('13/10/20')).toBe('2020-10-13');
    expect(parseDay('131026')).toBe('2026-10-13');
  });

  it('refuses a date that does not exist', () => {
    expect(parseDay('31/02/2026')).toBeNull();
    expect(parseDay('29/02/2025')).toBeNull();
    expect(parseDay('00/01/2026')).toBeNull();
    expect(parseDay('12/13/2026')).toBeNull();
    expect(parseDay('hello')).toBeNull();
    expect(parseDay('')).toBeNull();
  });

  it('accepts 29 February in a leap year', () => {
    expect(parseDay('29/02/2028')).toBe('2028-02-29');
  });

  it('shows a stored date the way it is typed', () => {
    expect(showDay('2026-03-31')).toBe('31/03/2026');
    expect(showDay('')).toBe('');
  });
});

function Harness({ start = '', onValue }: { start?: string; onValue: (value: string) => void }) {
  const [value, setValue] = useState(start);
  return (
    <DateInput
      aria-label="Date"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onValue(event.target.value);
      }}
    />
  );
}

describe('the date box', () => {
  it('puts the slashes in while the digits are typed, and reports the date once it is whole', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<Harness onValue={(value) => seen.push(value)} />);

    await user.type(screen.getByLabelText('Date'), '13102026');

    expect(screen.getByLabelText('Date')).toHaveValue('13/10/2026');
    // Nothing half-typed is reported: no 0020, no 0202.
    expect(seen).toEqual(['2026-10-13']);
  });

  it('takes a two-digit year when the box is left', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<Harness onValue={(value) => seen.push(value)} />);

    await user.type(screen.getByLabelText('Date'), '131026');
    expect(seen).toEqual([]);
    await user.tab();
    expect(seen).toEqual(['2026-10-13']);
    expect(screen.getByLabelText('Date')).toHaveValue('13/10/2026');
  });

  it('shows a date it was given', () => {
    render(<Harness start="2027-01-31" onValue={() => undefined} />);
    expect(screen.getByLabelText('Date')).toHaveValue('31/01/2027');
  });

  it('reports a cleared box as no date', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<Harness start="2027-01-31" onValue={(value) => seen.push(value)} />);

    await user.clear(screen.getByLabelText('Date'));
    expect(seen.at(-1)).toBe('');
  });

  it('puts back the last good date when something unreadable is left in it', async () => {
    const user = userEvent.setup();
    render(<Harness start="2027-01-31" onValue={() => undefined} />);

    const box = screen.getByLabelText('Date');
    await user.clear(box);
    await user.type(box, '3102');
    await user.tab();
    expect(box).toHaveValue('');
  });
});
