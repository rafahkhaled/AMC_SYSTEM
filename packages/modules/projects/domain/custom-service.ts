import { Conflict, type Result, err, ok } from '@amc/kernel';
import type { ServiceTemplate } from './service-template.js';

/**
 * A service the firm adds itself (feedback item 8).
 *
 * The eleven built-ins are code because each carries a deadline rule and a
 * recurrence the engine has to understand. What the firm needs to add on its
 * own is the plain case — "we have started doing X: once per client, with
 * these steps, needing these documents" — and this is what that is. It is
 * deliberately one-off with a number of days or a date set by hand: a
 * recurring custom service would need a period rule of its own, which is the
 * part that has to be written, not configured.
 */

export interface CustomServiceInput {
  readonly nameEn: string;
  readonly nameAr: string;
  /** Days from the day work starts to when it is due. Null: set by hand. */
  readonly deadlineDays: number | null;
  readonly steps: readonly { nameEn: string; nameAr: string }[];
  readonly requiredDocuments: readonly { type: string; mandatory: boolean }[];
}

export const CUSTOM_PREFIX = 'custom_';
export const CUSTOM_CODE_PATTERN = /^custom_[a-z0-9_]{1,60}$/;

export function isCustomServiceCode(value: string): boolean {
  return CUSTOM_CODE_PATTERN.test(value);
}

/**
 * A code out of the English name.
 *
 * Generated, never typed: an administrator choosing codes is how two services
 * end up answering to one. `taken` is every code already in use, retired ones
 * included, so a retired service's code is never handed out again to
 * something different.
 */
export function codeFor(nameEn: string, taken: ReadonlySet<string>): Result<string, Conflict> {
  const slug = nameEn
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  if (slug.length === 0) {
    // An Arabic-only name has no letters to build a code from. The English name
    // is required anyway; saying why is better than a code of `custom_`.
    return err(new Conflict('Give the English name using letters or numbers'));
  }

  const base = `${CUSTOM_PREFIX}${slug}`;
  if (!taken.has(base)) return ok(base);
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return ok(candidate);
  }
  return err(new Conflict('Too many services with that name'));
}

/**
 * Checks what an administrator typed and turns it into a template the rest of
 * the system treats like any other.
 */
export function defineCustomService(
  code: string,
  input: CustomServiceInput,
): Result<ServiceTemplate, Conflict> {
  const nameEn = input.nameEn.trim();
  const nameAr = input.nameAr.trim();
  if (nameEn.length === 0 || nameAr.length === 0) {
    // Arabic first for the people who use it, English for the documents that
    // go to the authority; a service missing either is half a service.
    return err(new Conflict('Name the service in both English and Arabic'));
  }

  if (
    input.deadlineDays !== null &&
    (!Number.isInteger(input.deadlineDays) || input.deadlineDays < 1 || input.deadlineDays > 730)
  ) {
    return err(new Conflict('A deadline is between 1 and 730 days, or left to be set by hand'));
  }

  const steps = input.steps
    .map((step) => ({ nameEn: step.nameEn.trim(), nameAr: step.nameAr.trim() }))
    .filter((step) => step.nameEn.length > 0 || step.nameAr.length > 0)
    // One language is enough to describe a step; the other falls back to it
    // rather than showing a blank on whichever screen is not in that language.
    .map((step) => ({
      nameEn: step.nameEn || step.nameAr,
      nameAr: step.nameAr || step.nameEn,
    }));
  if (steps.length === 0) {
    return err(new Conflict('A service needs at least one step'));
  }

  const seen = new Set<string>();
  for (const document of input.requiredDocuments) {
    if (seen.has(document.type)) {
      return err(new Conflict('Each document type can be listed once'));
    }
    seen.add(document.type);
  }

  return ok({
    code,
    nameEn,
    nameAr,
    recurrence: 'once',
    deadline:
      input.deadlineDays === null
        ? { kind: 'manual' }
        : { kind: 'days_from_start', days: input.deadlineDays },
    tasks: steps.map((step, index) => ({ order: index + 1, ...step })),
    requiredDocuments: input.requiredDocuments.map((document) => ({
      type: document.type,
      mandatory: document.mandatory,
    })),
  });
}
