/**
 * Reading what a client wrote.
 *
 * Deliberately a keyword reader and not a language model. What this has to get
 * right is a client typing "2" or "متى موعد الإقرار؟" on a phone, and the cost
 * of getting it wrong is not a bad answer but a wrong one sent in the
 * practice's name about somebody's tax. So it recognises a short list of things
 * confidently, and everything it does not recognise goes to a person — which is
 * the outcome a client wanted anyway.
 *
 * Arabic here is not a translation of the English. People write to an
 * accountant in Gulf Arabic with Egyptian spellings and no diacritics, and half
 * of them switch to English mid-sentence. The normalisation below is what makes
 * `الإقرار`, `الاقرار` and `اقرار` the same word.
 */

export type Intent =
  | { kind: 'greeting' }
  | { kind: 'deadlines' }
  | { kind: 'documents' }
  | { kind: 'human' }
  | { kind: 'thanks' }
  | { kind: 'stop' }
  | { kind: 'start' }
  | { kind: 'unclear' };

export type Language = 'en' | 'ar';

/** What the bot last asked for, so the next message can be read as an answer. */
export type Awaiting = 'menu_choice' | 'documents' | null;

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿ]/;

/**
 * Which language to answer in.
 *
 * Any Arabic at all means Arabic. Somebody writing `شكرا thanks` reads Arabic;
 * somebody writing only English may or may not, and English is the safer guess
 * there because it is the language they just chose.
 */
export function languageOf(body: string, remembered: Language): Language {
  if (ARABIC_SCRIPT.test(body)) return 'ar';
  // A message with no letters at all — "2", "👍" — says nothing about
  // language, so whatever they wrote in last time stands.
  if (!/[a-zA-Z]/.test(body)) return remembered;
  return 'en';
}

/**
 * Reduces Arabic to one spelling, and everything to lower case.
 *
 * `أ إ آ ٱ` all become `ا`, `ة` becomes `ه`, `ى` becomes `ي`, and the
 * diacritics and the tatweel stretching character are dropped. Without this,
 * `الإقرار` and `الاقرار` are different words and only one of them is in the
 * list below — which is the sort of thing that works for whoever wrote the list
 * and for nobody else.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[ً-ْٰـ]/g, '');
}

/**
 * The words that mean each thing, already normalised.
 *
 * Matched against whole words rather than as substrings: "sender" contains
 * "send" and a client writing "the sender was wrong" is not offering to send
 * anything.
 */
const WORDS: Readonly<Record<Exclude<Intent['kind'], 'unclear'>, readonly string[]>> = {
  start: ['start', 'resume', 'subscribe', 'تفعيل', 'فعل', 'ابدا', 'استمرار'],
  stop: ['stop', 'unsubscribe', 'remove', 'ايقاف', 'اوقف', 'الغاء', 'كفايه', 'لاتراسلني'],
  human: [
    'human',
    'person',
    'someone',
    'somebody',
    'agent',
    'speak',
    'talk',
    'manager',
    'accountant',
    'call',
    'موظف',
    'محاسب',
    'شخص',
    'انسان',
    'اتصل',
    'اتصال',
    'مكالمه',
    'اكلم',
    'كلمني',
    'احد',
    'مسؤول',
    'المدير',
  ],
  documents: [
    'document',
    'documents',
    'doc',
    'docs',
    'invoice',
    'invoices',
    'receipt',
    'receipts',
    'statement',
    'statements',
    'attach',
    'attached',
    'upload',
    'papers',
    'مستند',
    'مستندات',
    'وثيقه',
    'وثايق',
    'فاتوره',
    'فواتير',
    'ايصال',
    'ايصالات',
    'كشف',
    'كشوفات',
    'اوراق',
    'مرفق',
    'مرفقات',
    'ارسل',
    'ابعت',
    'ارفع',
  ],
  deadlines: [
    'deadline',
    'deadlines',
    'due',
    'when',
    'date',
    'dates',
    'vat',
    'tax',
    'return',
    'returns',
    'filing',
    'file',
    'submission',
    'موعد',
    'مواعيد',
    'متي',
    'تاريخ',
    'ضريبه',
    'ضرايب',
    'اقرار',
    'اقرارات',
    'تقديم',
    'استحقاق',
    'مستحق',
  ],
  greeting: [
    'hi',
    'hello',
    'hey',
    'salam',
    'morning',
    'evening',
    'مرحبا',
    'اهلا',
    'هلا',
    'السلام',
    'سلام',
    'عليكم',
    'صباح',
    'مساء',
  ],
  thanks: ['thanks', 'thank', 'thx', 'appreciated', 'شكرا', 'مشكور', 'تسلم', 'يعطيك', 'جزاك'],
};

/**
 * The order things are checked in, most specific first.
 *
 * A message can carry two of these — "شكرا، بس متى موعد الإقرار؟" is thanks and
 * a question — and the one worth answering is the question. Asking for a person
 * outranks everything except asking to be left alone, because somebody who
 * wants a human has already decided the bot is not helping.
 */
const ORDER: readonly Exclude<Intent['kind'], 'unclear'>[] = [
  'start',
  'stop',
  'human',
  'documents',
  'deadlines',
  'greeting',
  'thanks',
];

/**
 * Splits into words, across both scripts, dropping punctuation and emoji.
 *
 * Each word is added twice when it carries the definite article: `الفواتير`
 * and `فواتير`. Arabic attaches `ال` to the front of the noun, so a list of
 * bare words matched against whole words recognises none of the ways anybody
 * actually writes — `عندي الفواتير` is the normal sentence and `عندي فواتير`
 * is the unusual one. Both forms are kept rather than only the stripped one,
 * because a handful of words begin with those two letters on their own.
 */
function wordsIn(text: string): Set<string> {
  const words = new Set<string>();
  for (const word of normalise(text).split(/[^\p{L}\p{N}]+/u)) {
    if (word.length === 0) continue;
    words.add(word);
    if (word.startsWith('\u0627\u0644') && word.length > 3) words.add(word.slice(2));
  }
  return words;
}

/**
 * What the client meant, as far as this can tell.
 *
 * `awaiting` is what the bot last asked for. When a menu was offered, a bare
 * number is an answer to it — and only then, because "2" in the middle of a
 * conversation about invoices means two invoices.
 */
export function readIntent(body: string, awaiting: Awaiting = null): Intent {
  const trimmed = body.trim();
  if (trimmed.length === 0) return { kind: 'unclear' };

  if (awaiting === 'menu_choice') {
    const chosen = MENU[trimmed.replace(/[.)\s]/g, '')];
    if (chosen) return { kind: chosen };
  }

  const words = wordsIn(trimmed);
  for (const kind of ORDER) {
    if (WORDS[kind].some((word) => words.has(word))) return { kind };
  }

  return { kind: 'unclear' };
}

/** The numbered menu, in the order `menuText` prints it. */
const MENU: Readonly<Record<string, Exclude<Intent['kind'], 'unclear'> | undefined>> = {
  '1': 'deadlines',
  '2': 'documents',
  '3': 'human',
  '١': 'deadlines',
  '٢': 'documents',
  '٣': 'human',
};
