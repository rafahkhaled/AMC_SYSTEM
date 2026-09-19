import type { Language } from './intent.js';

/**
 * What the bot says.
 *
 * Every line here goes out over the practice's name to somebody's phone, about
 * their tax, so the rules it is written to are narrow:
 *
 * - It states what the system knows and never what it infers. A deadline comes
 *   from the deadline engine or it is not mentioned.
 * - It never gives advice. "Your return is due on the 28th" is a fact; "you
 *   should file early" is advice, and advice from a bot is the practice's
 *   liability.
 * - It always leaves a way to reach a person, in every reply, because the one
 *   thing worse than a bot that cannot help is a bot that cannot be escaped.
 * - It says "we" and not "I". The client is talking to the firm.
 *
 * The Arabic is not a translation of the English — it is what somebody would
 * actually write to a client here, which is shorter and more formal than the
 * English. Both are kept in one place so a change to one is visibly a change to
 * only one.
 */
export interface Wording {
  readonly en: string;
  readonly ar: string;
}

export function say(wording: Wording, language: Language): string {
  return wording[language];
}

/** The numbered list. `readIntent` reads a bare number against this order. */
export const MENU: Wording = {
  en: [
    'Reply with a number:',
    '1 — My deadlines',
    '2 — Send documents',
    '3 — Speak to someone',
  ].join('\n'),
  ar: ['أرسل رقماً:', '١ — مواعيدي', '٢ — إرسال مستندات', '٣ — التحدث مع أحد الموظفين'].join('\n'),
};

export function greeting(practiceName: Wording): Wording {
  return {
    en: `Hello, and welcome to ${practiceName.en}.\n\n${MENU.en}`,
    ar: `أهلاً وسهلاً بكم في ${practiceName.ar}.\n\n${MENU.ar}`,
  };
}

/**
 * The reply to a number nobody recognises.
 *
 * It does not say "you are not a client of ours", which is both rude and
 * possibly wrong — it is far more often a client writing from a second phone.
 */
export const UNRECOGNISED: Wording = {
  en: "Thank you for your message. We don't recognise this number yet, so one of our team will read it and reply to you shortly.",
  ar: 'شكراً لتواصلكم. هذا الرقم غير مسجّل لدينا بعد، وسيطّلع أحد موظفينا على رسالتكم ويرد عليكم قريباً.',
};

/** Nothing due. Said plainly, and without implying nothing is ever due. */
export const NO_DEADLINES: Wording = {
  en: "You have nothing due in the next 60 days according to our records.\n\nIf you're expecting something, reply 3 and we'll check it for you.",
  ar: 'لا توجد لديكم استحقاقات خلال الـ ٦٠ يوماً القادمة حسب سجلاتنا.\n\nإذا كنتم تتوقعون خلاف ذلك، أرسلوا ٣ وسنتحقق من الأمر.',
};

/** One line of the deadline list, already formatted by the caller. */
export interface DeadlineLine {
  readonly label: Wording;
  readonly dueOn: string;
}

export function deadlines(lines: readonly DeadlineLine[]): Wording {
  if (lines.length === 0) return NO_DEADLINES;

  const en = lines.map((line) => `• ${line.label.en} — due ${line.dueOn}`).join('\n');
  const ar = lines.map((line) => `• ${line.label.ar} — بتاريخ ${line.dueOn}`).join('\n');

  return {
    en: `Here is what we have for you:\n\n${en}\n\nReply 3 if you'd like to go through any of it with someone.`,
    ar: `هذه الاستحقاقات المسجّلة لديكم:\n\n${ar}\n\nأرسلوا ٣ إذا رغبتم بمناقشة أي منها مع أحد الموظفين.`,
  };
}

/** Asking for the files. Says what happens next, so nobody is left waiting. */
export const SEND_DOCUMENTS: Wording = {
  en: "Please send them here as photos or files — you can send several, one after another.\n\nWe'll confirm each one, and your accountant will review them.",
  ar: 'أرسلوها هنا كصور أو ملفات — ويمكنكم إرسال أكثر من ملف تباعاً.\n\nسنؤكد استلام كل ملف، وسيقوم المحاسب المختص بمراجعتها.',
};

/**
 * What is said when a file arrives.
 *
 * "Received" and nothing more. Not "thank you, that's everything we need",
 * which the bot has no way of knowing and which a client will hold the practice
 * to when a filing is late.
 */
export function documentReceived(filename: string | null): Wording {
  const named = filename ? ` (${filename})` : '';
  return {
    en: `Received${named}. Your accountant will review it.`,
    ar: `تم الاستلام${named}. سيقوم المحاسب المختص بمراجعته.`,
  };
}

/** What is said when a file arrives from a number nobody has matched. */
export const DOCUMENT_FROM_STRANGER: Wording = {
  en: "Received, thank you. As we don't recognise this number yet, one of our team will check where it belongs before it's filed.",
  ar: 'تم الاستلام، شكراً لكم. وبما أن هذا الرقم غير مسجّل لدينا بعد، سيتحقق أحد موظفينا من الجهة التي يخصها قبل حفظه.',
};

/**
 * Handing over to a person.
 *
 * It promises a reply, not a time. The practice works Monday to Friday and a
 * bot promising "within an hour" at nine on a Friday night is a complaint.
 */
export const HANDING_OVER: Wording = {
  en: "Of course — I've passed this to our team and someone will reply to you here.",
  ar: 'بكل تأكيد — تم تحويل رسالتكم إلى الفريق وسيرد عليكم أحد الموظفين هنا.',
};

export const THANKS: Wording = {
  en: "You're welcome. Send 1, 2 or 3 any time.",
  ar: 'العفو. يمكنكم إرسال ١ أو ٢ أو ٣ في أي وقت.',
};

/** First time the bot does not follow. It asks once, and shows the menu. */
export const DID_NOT_FOLLOW: Wording = {
  en: `Sorry, I didn't quite follow that.\n\n${MENU.en}`,
  ar: `عذراً، لم أفهم طلبكم.\n\n${MENU.ar}`,
};

/**
 * Second time. It stops asking and fetches somebody.
 *
 * A bot that says "sorry, I didn't catch that" three times running is worse
 * than no bot at all: it has spent the client's patience and still produced
 * nothing.
 */
export const GIVING_UP: Wording = {
  en: "I'm not able to help with that one — I've passed it to our team and someone will reply to you here.",
  ar: 'لا أستطيع المساعدة في هذا الطلب — وقد حوّلته إلى الفريق وسيرد عليكم أحد الموظفين هنا.',
};

/** Two in a row is where it stops trying. */
export const UNCLEAR_LIMIT = 2;

/**
 * Being asked to stop.
 *
 * It confirms, says what is still true — the practice will keep working — and
 * says how to undo it, because somebody who typed "stop" at a reminder rarely
 * meant "never contact me about my tax again".
 */
export const STOPPED: Wording = {
  en: "Understood — we won't send you automatic messages here any more. Your accountant will still contact you directly.\n\nSend START at any time to turn them back on.",
  ar: 'تم — لن نرسل لكم رسائل تلقائية على هذا الرقم بعد الآن. وسيستمر المحاسب المختص بالتواصل معكم مباشرة.\n\nأرسلوا START في أي وقت لإعادة تفعيلها.',
};

/**
 * What is said about something the bot cannot read at all — a voice note, a
 * location pin, a contact card.
 *
 * It does not pretend to have understood, and it does not ask them to type it
 * out instead, which is an imposition when they chose a voice note for a
 * reason. It fetches a person.
 */
export const CANNOT_READ: Wording = {
  en: "Thank you — I can't read that one myself, so I've passed it to our team and someone will reply to you here.",
  ar: 'شكراً لكم — لا يمكنني قراءة هذا النوع من الرسائل، لذا حوّلتها إلى الفريق وسيرد عليكم أحد الموظفين هنا.',
};
