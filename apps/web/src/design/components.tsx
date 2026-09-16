import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  forwardRef,
  useId,
} from 'react';

/**
 * Joins class names, keeping only real strings. Taking unknown rather than a
 * union matters: `affix && 'with-affix'` yields 0 when affix is the number 0,
 * and a stray "0" in a class list is the sort of thing nobody ever finds.
 */
function classes(...values: unknown[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}

type ButtonTone = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  block?: boolean;
  small?: boolean;
  /** Shows a spinner and blocks further presses. */
  busy?: boolean;
}

/**
 * A button that says what it is doing.
 *
 * `busy` disables it as well as showing a spinner, because the failure this
 * prevents is a double submission, and a spinner alone prevents nothing. The
 * type defaults to "button": a button inside a form that does not say
 * otherwise submits it, which is rarely what was meant.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone = 'primary', block, small, busy, children, className, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes(
        'button',
        tone !== 'primary' && `button--${tone}`,
        block && 'button--block',
        small && 'button--small',
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | undefined;
  /** For identifiers read left to right whatever the interface language. */
  ltr?: boolean;
  affix?: ReactNode;
  /**
   * A control other than a text input — a select, say.
   *
   * It is given the field's id and description through a render function
   * rather than plain children, because a label that points at nothing and a
   * hint no screen reader reaches are the two failures this component exists
   * to prevent, and passing children would make both easy again.
   */
  control?: (props: { id: string; 'aria-describedby': string | undefined }) => ReactNode;
}

/**
 * A labelled input with its hint and error wired up for assistive technology.
 *
 * The label is a real label bound by id, the error carries aria-invalid, and
 * both hint and error are named in aria-describedby. Done by hand on every
 * form, one of those is always forgotten; done here, none of them is.
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, ltr, affix, className, id, control, ...rest },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="field__control">
        {control ? (
          control({ id: inputId, 'aria-describedby': describedBy || undefined })
        ) : (
          <input
            ref={ref}
            id={inputId}
            className={classes(
              'input',
              ltr && 'input--ltr',
              affix && 'input--with-affix',
              className,
            )}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            {...rest}
          />
        )}
        {affix ? <span className="field__affix">{affix}</span> : null}
      </div>
      {hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
});

export type AlertTone = 'error' | 'warning' | 'success' | 'info';

/**
 * A message about what just happened.
 *
 * An error is announced assertively because it usually means the thing the
 * person tried did not happen; anything else is announced politely so it does
 * not interrupt what they are reading.
 */
export function Alert({ tone = 'info', children }: { tone?: AlertTone; children: ReactNode }) {
  return (
    <div
      className={classes('alert', `alert--${tone}`)}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      {children}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'warning' | 'danger' | 'success';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={classes('badge', tone !== 'neutral' && `badge--${tone}`)}>{children}</span>
  );
}

export function Card({
  title,
  description,
  children,
  floating,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  floating?: boolean;
}) {
  return (
    <section className={classes('card', floating && 'card--floating')}>
      {title || description ? (
        <header className="card__header">
          {title ? <h2>{title}</h2> : null}
          {description ? <p className="u-text-soft">{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Empty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty">
      <p>{title}</p>
      {description ? <p className="u-text-faint">{description}</p> : null}
    </div>
  );
}

/**
 * A spinner with a label, because a spinner alone says nothing to a reader.
 *
 * `output` rather than a div with role="status": it carries that role already,
 * and the element is the thing rather than a description of it.
 */
export function Loading({ label }: { label: string }) {
  return (
    <output className="u-row">
      <span className="spinner" aria-hidden="true" />
      <span className="u-text-soft">{label}</span>
    </output>
  );
}
