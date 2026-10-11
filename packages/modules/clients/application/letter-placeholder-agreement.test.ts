import { letterPlaceholders } from '@amc/contracts';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDERS, templateCodeFor, unknownPlaceholdersIn } from '../domain/letter.js';

/**
 * The contract lists what a screen may offer as buttons; the domain lists what
 * it will fill in. They are separate declarations because the domain may not
 * import contracts, and this is what stops them drifting apart: a button for a
 * fact that is never filled in is a letter that goes out with braces in it.
 */
describe('the facts a letter can be told', () => {
  it('are the same in the contract and in the domain', () => {
    expect([...letterPlaceholders].sort()).toEqual([...PLACEHOLDERS].sort());
  });
});

describe('checking a template body', () => {
  it('finds a placeholder that will not be filled in', () => {
    expect(unknownPlaceholdersIn('Dear {{client_name}}, {{director}} and {{ today }}')).toEqual([
      'director',
    ]);
  });

  it('finds nothing wrong with a body that uses only known ones', () => {
    expect(unknownPlaceholdersIn('{{client_name}} {{vat_trn}}')).toEqual([]);
  });

  it('reports each unknown one once', () => {
    expect(unknownPlaceholdersIn('{{x}} {{x}} {{y}}')).toEqual(['x', 'y']);
  });
});

describe('the code a letter is given', () => {
  it('is made from the English name', () => {
    expect(templateCodeFor('Salary Certificate – Request', new Set())).toBe(
      'salary_certificate_request',
    );
  });

  it('avoids one already taken, retired or not', () => {
    expect(templateCodeFor('Engagement letter', new Set(['engagement_letter']))).toBe(
      'engagement_letter_2',
    );
  });

  it('is nothing for a name with no letters or numbers', () => {
    expect(templateCodeFor('خطاب', new Set())).toBeNull();
  });
});
