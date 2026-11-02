import { describe, expect, it } from 'vitest';
import { DocumentTemplate, placeholdersIn, renderLetter } from './letter.js';

describe('filling in a letter (FR-15)', () => {
  it('puts the client into the wording', () => {
    expect(
      renderLetter('We act for {{client_name}}, licence {{trade_licence}}.', {
        client_name: 'Gulf Trading LLC',
        trade_licence: 'CN-1234567',
      }),
    ).toBe('We act for \u2068Gulf Trading LLC\u2069, licence \u2068CN-1234567\u2069.');
  });

  it('leaves a visible gap where a fact is missing, never a blank', () => {
    /*
     * A letter with nothing where the tax number should be reads as finished
     * and is not, and somebody signs it. A row of underscores is the thing
     * that gets noticed before it goes out.
     */
    const rendered = renderLetter('TRN: {{vat_trn}}.', {});
    expect(rendered).toBe('TRN: __________.');
    expect(rendered).not.toBe('TRN: .');
  });

  it('treats an empty value as missing, because it is', () => {
    expect(renderLetter('TRN: {{vat_trn}}.', { vat_trn: '   ' })).toContain('__________');
  });

  it('leaves a placeholder it does not know exactly as written', () => {
    // Somebody proofreading sees {{director_name}} and knows what happened.
    // A silent deletion leaves a sentence with a hole in it.
    expect(renderLetter('Signed by {{director_name}}.', {})).toBe('Signed by {{director_name}}.');
  });

  it('prints an ampersand as an ampersand', () => {
    // The letter is shown and printed as text, never as HTML, so escaping it
    // printed "Riad &amp; Amine" on a client's letter.
    expect(renderLetter('{{client_name}}', { client_name: 'Riad & Amine' })).toBe(
      '\u2068Riad & Amine\u2069',
    );
  });

  it('keeps a number in its own order inside Arabic text', () => {
    expect(renderLetter('رقم الرخصة {{trade_licence}}.', { trade_licence: '923585' })).toBe(
      'رقم الرخصة \u2068923585\u2069.',
    );
  });

  it('tolerates spacing inside the braces', () => {
    expect(renderLetter('{{ client_name }}', { client_name: 'Gulf' })).toBe('\u2068Gulf\u2069');
  });

  it('lists the facts a template needs, so a preview can say what is missing', () => {
    expect(
      placeholdersIn('Dear {{client_name}}, your TRN {{vat_trn}} and {{vat_trn}} again.').sort(),
    ).toEqual(['client_name', 'vat_trn']);
  });

  it('renders the language that was asked for', () => {
    const template = DocumentTemplate.of({
      id: 't-1',
      code: 'engagement',
      nameEn: 'Engagement letter',
      nameAr: 'خطاب التكليف',
      bodyEn: 'We act for {{client_name}}.',
      bodyAr: 'نعمل لصالح {{client_name}}.',
    });
    expect(template.ok).toBe(true);
    if (!template.ok) return;

    expect(template.value.render('ar', { client_name: 'الخليج' })).toEqual({
      title: 'خطاب التكليف',
      body: 'نعمل لصالح الخليج.',
    });
    expect(template.value.render('en', { client_name: 'Gulf Trading LLC' }).title).toBe(
      'Engagement letter',
    );
  });

  it('refuses a template with wording in only one language', () => {
    // The practice works in both. A letter that exists in English only is one
    // somebody will reach for in Arabic and find empty.
    expect(
      DocumentTemplate.of({
        id: 't-2',
        code: 'half',
        nameEn: 'Half a letter',
        nameAr: 'نصف خطاب',
        bodyEn: 'Something.',
        bodyAr: '   ',
      }).ok,
    ).toBe(false);
  });
});
