import { type ChangeEvent, type InputHTMLAttributes, useEffect, useRef, useState } from 'react';

/** "2026-03-31" from "31/03/2026", "31/3/26", "31032026" or "2026-03-31"; null if unreadable. */
export function parseDay(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  let day: number;
  let month: number;
  let year: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const split = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/.exec(trimmed);
  const digits = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(trimmed);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (split || digits) {
    const parts = (split ?? digits) as RegExpExecArray;
    day = Number(parts[1]);
    month = Number(parts[2]);
    year = Number(parts[3]);
    // Two digits is this century: nobody files a 1926 trade licence.
    if (year < 100) year += 2000;
  } else {
    return null;
  }
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "31/03/2026" from "2026-03-31". */
export function showDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** Puts the slashes in while somebody types the digits. */
function shape(typed: string): string {
  if (/^\d{4}-/.test(typed)) return typed; // somebody typing the ISO form
  const digits = typed.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * A date typed straight through: 31032026 becomes 31/03/2026.
 *
 * The browser's own date box made people click into the year before typing it,
 * turned "20" into the year 0020, and seemed to stick. This one takes the
 * digits in order, accepts a two-digit year, and still offers the browser's
 * calendar from the button beside it. The value it reports is the same
 * "2026-03-31" the rest of the application already uses, so nothing that uses
 * a date field had to change.
 */
export function DateInput({
  value,
  onChange,
  className,
  id,
  disabled,
  required,
  onBlur,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const current = typeof value === 'string' ? value : '';
  const [text, setText] = useState(showDay(current));
  const picker = useRef<HTMLInputElement>(null);

  // A value set from outside (cleared after saving, or loaded) is shown;
  // what is being typed is left alone while it still means the same date.
  useEffect(() => {
    setText((typed) => (parseDay(typed) === (current || null) ? typed : showDay(current)));
  }, [current]);

  const report = (iso: string) => {
    onChange?.({
      target: { value: iso },
      currentTarget: { value: iso },
    } as ChangeEvent<HTMLInputElement>);
  };

  return (
    <span className="date-input">
      <input
        {...rest}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        placeholder="dd/mm/yyyy"
        className={className}
        disabled={disabled}
        required={required}
        value={text}
        onChange={(event) => {
          const shaped = shape(event.target.value);
          setText(shaped);
          // While typing, only a four-digit year counts as finished: "13/10/20"
          // is on its way to "13/10/2026", not a date in 2020.
          const iso = /\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(shaped) ? parseDay(shaped) : null;
          if (iso) report(iso);
          else if (shaped === '') report('');
        }}
        onBlur={(event) => {
          // Something unreadable left in the box is cleared rather than kept,
          // so what is on screen is always what will be saved.
          const iso = parseDay(text);
          if (text !== '' && !iso) {
            setText(showDay(current));
          } else if (iso && iso !== current) {
            // A two-digit year, finished by leaving the box.
            setText(showDay(iso));
            report(iso);
          }
          onBlur?.(event);
        }}
      />
      <button
        type="button"
        className="date-input__calendar"
        aria-label="📅"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => {
          const native = picker.current;
          if (!native) return;
          try {
            native.showPicker();
          } catch {
            native.focus();
          }
        }}
      >
        📅
      </button>
      <input
        ref={picker}
        type="date"
        className="date-input__native"
        tabIndex={-1}
        aria-hidden="true"
        value={current}
        onChange={(event) => {
          setText(showDay(event.target.value));
          report(event.target.value);
        }}
      />
    </span>
  );
}
