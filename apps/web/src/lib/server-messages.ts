/**
 * What the server says when it refuses something, in Arabic.
 *
 * The server words its refusals in English, because they also go to logs and
 * to the tests. The person reading them on screen mostly reads Arabic, and an
 * English sentence in the middle of an Arabic form ("That client has no email
 * address on file") was one of the things the firm reported. The Arabic is
 * looked up by the exact English sentence; one that has no Arabic yet is shown
 * as it is rather than hidden.
 */
const ARABIC: Readonly<Record<string, string>> = {
  'A campaign needs a name': 'الحملة تحتاج إلى اسم',
  'A client needs a legal name': 'العميل يحتاج إلى اسم قانوني',
  'A completed project keeps the documents it was done with':
    'العمل المنجز يحتفظ بالمستندات التي أُنجز بها',
  'A credential needs a password': 'بيانات الدخول تحتاج إلى كلمة مرور',
  'A credential needs a username': 'بيانات الدخول تحتاج إلى اسم مستخدم',
  'A deadline is between 1 and 730 days, or left to be set by hand':
    'المهلة بين ١ و٧٣٠ يومًا، أو اتركها لتُحدَّد يدويًا',
  'A declined enquiry cannot become a client': 'لا يمكن تحويل استفسار مرفوض إلى عميل',
  'A discount cannot be for a negative amount': 'لا يمكن أن يكون الخصم بمبلغ سالب',
  'A discount cannot be more than the line it comes off': 'لا يمكن أن يزيد الخصم عن قيمة البند',
  'A document of this type needs an expiry date': 'هذا النوع من المستندات يحتاج إلى تاريخ انتهاء',
  'A financial year ends in a month from 1 to 12': 'تنتهي السنة المالية في شهر من ١ إلى ١٢',
  'A folder name cannot contain slashes': 'لا يمكن أن يحتوي اسم المجلد على شرطة مائلة',
  'A letter needs wording in both languages': 'الخطاب يحتاج إلى نص باللغتين',
  'A line cannot be adjusted to a negative amount': 'لا يمكن تعديل البند إلى مبلغ سالب',
  'A manual entry needs a reason': 'الإدخال اليدوي يحتاج إلى سبب',
  'A password is required': 'كلمة المرور مطلوبة',
  'A password must not contain your email address':
    'يجب ألا تحتوي كلمة المرور على بريدك الإلكتروني',
  'A payment has to be for something': 'يجب أن تكون الدفعة بمبلغ',
  'A payment has to be in the invoice’s own currency': 'يجب أن تكون الدفعة بعملة الفاتورة',
  'A period end month is between 1 and 12': 'شهر نهاية الفترة بين ١ و١٢',
  'A person needs a name': 'الموظف يحتاج إلى اسم',
  'A person needs at least one role': 'الموظف يحتاج إلى دور واحد على الأقل',
  'A quotation line cannot be for a negative amount': 'لا يمكن أن يكون بند عرض السعر بمبلغ سالب',
  'A quotation that has been sent cannot be changed, only replaced':
    'لا يمكن تعديل عرض سعر أُرسل، يمكن فقط استبداله بعرض جديد',
  'A quotation with no lines is not an offer': 'عرض السعر بلا بنود ليس عرضًا. أضف بندًا أولًا',
  'A quotation with that reference already exists': 'يوجد عرض سعر بهذا الرقم',
  'A rate already takes effect on that date': 'يوجد سعر يبدأ من هذا التاريخ',
  'A report period has to end after it starts': 'يجب أن تنتهي فترة التقرير بعد بدايتها',
  'A screenshot should be an image or a PDF': 'لقطة الشاشة يجب أن تكون صورة أو PDF',
  'A service needs at least one step': 'الخدمة تحتاج إلى خطوة واحدة على الأقل',
  'A statement period has to end after it starts': 'يجب أن تنتهي فترة الكشف بعد بدايتها',
  'A tax registration number is digits only': 'الرقم الضريبي أرقام فقط',
  'A tax registration number is required': 'الرقم الضريبي مطلوب',
  'A time entry cannot end before it started': 'لا يمكن أن ينتهي الوقت قبل أن يبدأ',
  'A timer cannot stop before it started': 'لا يمكن إيقاف المؤقّت قبل بدايته',
  'A working day has to end after it starts': 'يجب أن ينتهي يوم العمل بعد بدايته',
  'An email address is required': 'البريد الإلكتروني مطلوب',
  'An enquiry needs a name': 'الاستفسار يحتاج إلى اسم',
  'An enquiry needs a phone number or an email address':
    'الاستفسار يحتاج إلى رقم هاتف أو بريد إلكتروني',
  'An entry of no length records nothing': 'وقت بلا مدة لا يُسجَّل',
  'An expiry date must come after the issue date': 'يجب أن يكون تاريخ الانتهاء بعد تاريخ الإصدار',
  'An hourly rate cannot be negative': 'لا يمكن أن يكون سعر الساعة سالبًا',
  'Another client already has that VAT number': 'هذا الرقم الضريبي مسجّل لعميل آخر',
  'Choose a new password': 'اختر كلمة مرور جديدة',
  'Choose how it was paid': 'اختر طريقة الدفع',
  'Choose the branch this invoice is issued under': 'اختر الفرع الذي تصدر باسمه الفاتورة',
  'Choose the branch this quotation goes out under first':
    'اختر الفرع الذي يصدر باسمه عرض السعر أولًا',
  'Choose the type of campaign': 'اختر نوع الحملة',
  'Choose which portal this is for': 'اختر البوابة',
  'Closing time has to be after opening time': 'يجب أن يكون وقت الإغلاق بعد وقت الفتح',
  'Every line has been excluded, so there is nothing to bill':
    'استُبعدت كل البنود، فلا يوجد ما يُفوتَر',
  'Give both the opening and the closing time, or neither':
    'أدخل وقتي الفتح والإغلاق معًا، أو اتركهما فارغين',
  'Give the email address you sign in with': 'أدخل البريد الإلكتروني الذي تسجّل الدخول به',
  'Give the folder a name': 'أدخل اسم المجلد',
  'Move or remove what is inside this folder first': 'انقل محتويات المجلد أو احذفها أولًا',
  'Name the letter in both English and Arabic': 'أدخل اسم الخطاب بالعربية والإنجليزية',
  'Name the service in both English and Arabic': 'أدخل اسم الخدمة بالعربية والإنجليزية',
  'No file arrived with that upload': 'لم يصل أي ملف',
  'No such client': 'العميل غير موجود',
  'No such document': 'المستند غير موجود',
  'No such file': 'الملف غير موجود',
  'No such folder': 'المجلد غير موجود',
  'No such invoice': 'الفاتورة غير موجودة',
  'No such project': 'العمل غير موجود',
  'No such quotation': 'عرض السعر غير موجود',
  'No such statement': 'الكشف غير موجود',
  'No timer is running': 'لا يوجد مؤقّت يعمل',
  'Nothing was selected to approve': 'لم يُحدَّد شيء للاعتماد',
  'Only a draft can be sent': 'يمكن إرسال المسودة فقط',
  'Only an approved statement can be invoiced': 'يمكن فوترة الكشف المعتمد فقط',
  'Only approved time can be billed': 'يمكن فوترة الوقت المعتمد فقط',
  'Please give a valid email address': 'أدخل بريدًا إلكترونيًا صحيحًا',
  'Please give your name': 'أدخل اسمك',
  'Please sign in': 'سجّل الدخول',
  'Please sign in again': 'سجّل الدخول من جديد',
  'Say what the line is for, in at least one language': 'اكتب وصف البند بلغة واحدة على الأقل',
  'Say why the password is needed': 'اكتب سبب الاطّلاع على كلمة المرور',
  'Say why this was entered by hand': 'اكتب سبب إدخال الوقت يدويًا',
  'Say why, in a few words': 'اكتب السبب في كلمات قليلة',
  'Someone already uses that email address': 'هذا البريد الإلكتروني مستخدم لموظف آخر',
  'That client has no email address on file':
    'لا يوجد بريد إلكتروني لهذا العميل. أضفه من «تعديل البيانات» في ملف العميل',
  'That client has no email address on file; send it by hand instead':
    'لا يوجد بريد إلكتروني لهذا العميل. أضفه من «تعديل البيانات» في ملف العميل، أو اطبع العرض وسجّل أنه أُرسل',
  'That code is not right': 'الرمز غير صحيح',
  'That date range runs backwards': 'تاريخ البداية بعد تاريخ النهاية',
  'That image is too large; keep it under 400 KB': 'الصورة كبيرة، يجب ألا تتجاوز ٤٠٠ كيلوبايت',
  'That invoice is settled': 'هذه الفاتورة مسدّدة',
  'That is not an email address': 'هذا ليس بريدًا إلكترونيًا صحيحًا',
  'That password is too easy to guess': 'كلمة المرور سهلة التخمين',
  'That password is too long': 'كلمة المرور طويلة جدًا',
  'That period already has a project': 'يوجد عمل لهذه الفترة',
  'That person already has this project': 'هذا الموظف مسند إليه هذا العمل',
  'That quotation has already been answered': 'تم الرد على عرض السعر هذا',
  'That task is already done': 'هذه الخطوة منجزة',
  'The documents this work needs are not all here yet':
    'لم تصل كل المستندات المطلوبة لهذا العمل بعد',
  'The portal link has to start with http:// or https://':
    'يجب أن يبدأ رابط البوابة بـ http:// أو https://',
  'The portal needs a password': 'البوابة تحتاج إلى كلمة مرور',
  'The portal needs a username': 'البوابة تحتاج إلى اسم مستخدم',
  'The weekly day off is a day of the week': 'يوم العطلة يجب أن يكون يومًا من أيام الأسبوع',
  'There are no approved unbilled hours for that period':
    'لا توجد ساعات معتمدة غير مفوترة في هذه الفترة',
  'There is already a folder with that name here': 'يوجد مجلد بهذا الاسم هنا',
  'There is no such person': 'الموظف غير موجود',
  'This account is suspended': 'هذا الحساب موقوف',
  'This client is already registered for VAT': 'هذا العميل مسجّل في ضريبة القيمة المضافة',
  'This client is already registered for corporation tax': 'هذا العميل مسجّل في ضريبة الشركات',
  'This document has been replaced by a newer one': 'استُبدل هذا المستند بنسخة أحدث',
  'This enquiry has already become a client': 'تم تحويل هذا الاستفسار إلى عميل',
  'This link has expired or has already been used': 'انتهت صلاحية هذا الرابط أو استُخدم من قبل',
  'This session expired through inactivity. Sign in again.':
    'انتهت الجلسة بسبب عدم النشاط. سجّل الدخول من جديد.',
  'This session has reached its maximum length. Sign in again.':
    'وصلت الجلسة إلى أقصى مدة. سجّل الدخول من جديد.',
  'This system keeps PDFs and scans; that is neither': 'يقبل النظام ملفات PDF والصور الممسوحة فقط',
  'This time is already on a statement': 'هذا الوقت مدرج في كشف',
  'Those details are not right': 'البيانات غير صحيحة',
  'Time cannot be recorded for work not yet done': 'لا يمكن تسجيل وقت لعمل لم يُنجز بعد',
  'Times are written like 08:30': 'يُكتب الوقت هكذا: 08:30',
  'To register for corporation tax, say which month the financial year ends':
    'للتسجيل في ضريبة الشركات، اختر شهر نهاية السنة المالية',
  'Too many failed attempts. Try again shortly.': 'محاولات خاطئة كثيرة. حاول بعد قليل.',
  'Use a date in the form 2026-03-31': 'أدخل التاريخ بشكل صحيح',
  'What a manager may do is fixed, so nobody can lock the firm out':
    'صلاحيات المدير ثابتة حتى لا يُغلَق النظام على الشركة',
  'You cannot suspend your own account': 'لا يمكنك إيقاف حسابك',
  'You do not have access to this': 'ليست لديك صلاحية لهذا',
};

/** The message in the reader's language, or as the server wrote it. */
export function inReadersLanguage(message: string): string {
  let language = 'ar';
  try {
    language = document.documentElement.lang || 'ar';
  } catch {
    // No document (a test without one): Arabic, the interface default.
  }
  if (!language.startsWith('ar')) return message;
  return ARABIC[message] ?? message;
}
