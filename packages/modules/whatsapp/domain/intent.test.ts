import { describe, expect, it } from 'vitest';
import { type Intent, languageOf, normalise, readIntent } from './intent.js';

const meaning = (body: string, awaiting: Parameters<typeof readIntent>[1] = null): Intent['kind'] =>
  readIntent(body, awaiting).kind;

describe('reading what a client wrote, in English', () => {
  it('hears a greeting', () => {
    expect(meaning('Hi')).toBe('greeting');
    expect(meaning('Hello there')).toBe('greeting');
    expect(meaning('good morning')).toBe('greeting');
  });

  it('hears a question about dates', () => {
    expect(meaning('when is my VAT return due?')).toBe('deadlines');
    expect(meaning('What is the deadline')).toBe('deadlines');
    expect(meaning('any filing this month?')).toBe('deadlines');
  });

  it('hears an offer to send something', () => {
    expect(meaning('I have the invoices')).toBe('documents');
    expect(meaning('sending you the bank statements')).toBe('documents');
    expect(meaning('where do I upload the receipts')).toBe('documents');
  });

  it('hears somebody asking for a person', () => {
    expect(meaning('can I speak to someone')).toBe('human');
    expect(meaning('I want to talk to my accountant')).toBe('human');
    expect(meaning('call me please')).toBe('human');
  });

  it('hears thanks, and being asked to stop', () => {
    expect(meaning('thanks!')).toBe('thanks');
    expect(meaning('STOP')).toBe('stop');
  });
});

describe('reading what a client wrote, in Arabic', () => {
  it('hears a greeting', () => {
    expect(meaning('السلام عليكم')).toBe('greeting');
    expect(meaning('مرحبا')).toBe('greeting');
    expect(meaning('صباح الخير')).toBe('greeting');
  });

  it('hears a question about dates', () => {
    expect(meaning('متى موعد الإقرار؟')).toBe('deadlines');
    expect(meaning('ابغى اعرف مواعيد الضريبة')).toBe('deadlines');
  });

  it('hears an offer to send something', () => {
    expect(meaning('عندي الفواتير')).toBe('documents');
    expect(meaning('راح ارسل لكم المستندات')).toBe('documents');
  });

  it('hears somebody asking for a person', () => {
    expect(meaning('ابغى اكلم المحاسب')).toBe('human');
    expect(meaning('ممكن اتصال')).toBe('human');
  });

  it('does not care how the hamza was written', () => {
    // الإقرار, الاقرار and الأقرار are one word to everybody except a computer.
    expect(meaning('متى الإقرار')).toBe('deadlines');
    expect(meaning('متى الاقرار')).toBe('deadlines');
    expect(meaning('متى الأقرار')).toBe('deadlines');
  });

  it('does not care about the ta marbuta or the diacritics', () => {
    expect(meaning('الضريبة')).toBe('deadlines');
    expect(meaning('الضريبه')).toBe('deadlines');
    expect(meaning('الضَريبة')).toBe('deadlines');
  });
});

describe('when a message carries two things at once', () => {
  it('answers the question rather than the thanks', () => {
    expect(meaning('شكرا، بس متى موعد الإقرار؟')).toBe('deadlines');
    expect(meaning('thanks, when is the VAT due?')).toBe('deadlines');
  });

  it('gives them a person when they asked for one, whatever else they said', () => {
    expect(meaning('I have the invoices but I need to speak to someone')).toBe('human');
  });

  it('puts being asked to stop above everything', () => {
    expect(meaning('stop sending me invoices reminders')).toBe('stop');
  });
});

describe('the menu', () => {
  it('reads a bare number as a choice, but only right after the menu', () => {
    expect(meaning('2', 'menu_choice')).toBe('documents');
    expect(meaning('1', 'menu_choice')).toBe('deadlines');
    expect(meaning('3', 'menu_choice')).toBe('human');

    // Out of nowhere, "2" means nothing — in a conversation about invoices it
    // most likely means two of them.
    expect(meaning('2')).toBe('unclear');
  });

  it('reads the number however it was typed', () => {
    expect(meaning('2.', 'menu_choice')).toBe('documents');
    expect(meaning(' 2 ', 'menu_choice')).toBe('documents');
    expect(meaning('٢', 'menu_choice')).toBe('documents');
  });

  it('still reads words when a number was expected', () => {
    expect(meaning('actually can someone call me', 'menu_choice')).toBe('human');
  });
});

describe('what it does not understand', () => {
  it('says so rather than guessing', () => {
    expect(meaning('')).toBe('unclear');
    expect(meaning('   ')).toBe('unclear');
    expect(meaning('👍')).toBe('unclear');
    expect(meaning('ok')).toBe('unclear');
    expect(meaning('The lease was signed in Sharjah last spring')).toBe('unclear');
  });

  it('does not find a word inside a longer one', () => {
    // "sender" contains "send"; "attended" contains "attend"; neither is an
    // offer to send anything.
    expect(meaning('the sender was wrong')).toBe('unclear');
    expect(meaning('I attended the meeting')).toBe('unclear');
  });
});

describe('which language to answer in', () => {
  it('answers Arabic to any Arabic at all', () => {
    expect(languageOf('شكرا thanks', 'en')).toBe('ar');
    expect(languageOf('متى الإقرار', 'en')).toBe('ar');
  });

  it('answers English to English', () => {
    expect(languageOf('when is my return due', 'ar')).toBe('en');
  });

  it('keeps to what they wrote last when a message has no words', () => {
    expect(languageOf('2', 'ar')).toBe('ar');
    expect(languageOf('👍', 'en')).toBe('en');
  });
});

describe('normalise', () => {
  it('reduces the hamza forms to one letter', () => {
    expect(normalise('أإآٱ')).toBe('اااا');
  });

  it('drops the diacritics and the stretching character', () => {
    expect(normalise('مَرحَبــا')).toBe('مرحبا');
  });
});

describe('turning automatic messages back on', () => {
  it('hears START', () => {
    expect(meaning('START')).toBe('start');
    expect(meaning('start')).toBe('start');
    expect(meaning('تفعيل')).toBe('start');
  });

  it('is heard above STOP, so a client cannot say both and be muted', () => {
    expect(meaning('start sending reminders again, stop the calls')).toBe('start');
  });
});
