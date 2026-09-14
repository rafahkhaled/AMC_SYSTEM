/**
 * The error vocabulary every module shares.
 *
 * A DomainError is an expected, meaningful outcome — "this invoice is already
 * paid", "this task still needs documents" — not a crash. Use cases return them
 * inside a Result so the HTTP layer can map them to a status code without
 * catching exceptions.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }

  toJSON(): { code: string; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: { ...this.details } };
  }
}

/** A rule of the business was broken. The caller sent something the domain refuses. */
export class InvariantViolation extends DomainError {
  readonly code = 'INVARIANT_VIOLATION';
}

/** The requested record does not exist, or the caller may not know that it does. */
export class NotFound extends DomainError {
  readonly code = 'NOT_FOUND';
}

/** The caller is authenticated but not permitted. */
export class Forbidden extends DomainError {
  readonly code = 'FORBIDDEN';
}

/** The action collides with the current state, e.g. a state transition that is not allowed. */
export class Conflict extends DomainError {
  readonly code = 'CONFLICT';
}

/** Input failed validation before any domain rule was consulted. */
export class ValidationFailed extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}

/**
 * Thrown, never returned. Signals a programming mistake — a value object built
 * with impossible arguments. These must never reach a user.
 */
export class ProgrammerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgrammerError';
  }
}
