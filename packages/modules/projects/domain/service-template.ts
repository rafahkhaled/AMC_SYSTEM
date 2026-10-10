/**
 * The eleven services the practice sells (FR-10).
 *
 * Defined in code rather than as rows, because each one carries a deadline
 * rule and a recurrence that the engine has to understand. A row in a table
 * cannot say "nine months after the client's financial year ends"; it can only
 * say a number that some code then interprets, and then the meaning lives in
 * two places.
 */
export type BuiltInServiceCode =
  | 'ct_registration'
  | 'vat_registration'
  | 'vat_return'
  | 'ct_return'
  | 'tax_profile_update'
  | 'deregistration'
  | 'vat_refund'
  | 'penalty_waiver'
  | 'emaratax_request'
  | 'monthly_accounting'
  | 'audit';

/**
 * Any service the firm offers: one of the eleven above, or one it added itself.
 *
 * A plain string because the second kind is data, not code. The built-in codes
 * are still a closed union (`BuiltInServiceCode`) wherever the engine needs to
 * know what it is dealing with.
 */
export type ServiceCode = string;

/** How often the work comes round again (FR-14). */
export type Recurrence =
  | 'once'
  /** Every month, for bookkeeping. */
  | 'monthly'
  /** Once per VAT period, which is per client because the cycles are staggered. */
  | 'per_vat_period'
  /** Once per financial year, which is also per client. */
  | 'per_financial_year';

/**
 * How the due date is worked out.
 *
 * Named rules rather than a number of days, because two of them depend on the
 * client's own cycle and one depends on nothing at all.
 */
export type DeadlineRule =
  /** The 28th of the month after the VAT period ends (FR-40). */
  | { kind: 'vat_return' }
  /** Nine months after the financial year ends. */
  | { kind: 'ct_return' }
  /** A fixed number of days from when the work starts. */
  | { kind: 'days_from_start'; days: number }
  /** Set by hand, because the authority sets it case by case. */
  | { kind: 'manual' };

export interface TemplateTask {
  readonly order: number;
  readonly nameEn: string;
  readonly nameAr: string;
}

export interface RequiredDocument {
  readonly type: string;
  /**
   * Mandatory documents gate the work: a project cannot start without them
   * (FR-12). Everything else is a prompt, not a blocker.
   */
  readonly mandatory: boolean;
}

export interface ServiceTemplate {
  readonly code: ServiceCode;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly recurrence: Recurrence;
  readonly deadline: DeadlineRule;
  readonly tasks: readonly TemplateTask[];
  readonly requiredDocuments: readonly RequiredDocument[];
}

const task = (order: number, nameEn: string, nameAr: string): TemplateTask => ({
  order,
  nameEn,
  nameAr,
});

const needs = (type: string, mandatory = true): RequiredDocument => ({ type, mandatory });

export const SERVICE_TEMPLATES: Readonly<Record<BuiltInServiceCode, ServiceTemplate>> = {
  vat_registration: {
    code: 'vat_registration',
    nameEn: 'VAT registration',
    nameAr: 'التسجيل في ضريبة القيمة المضافة',
    recurrence: 'once',
    deadline: { kind: 'days_from_start', days: 30 },
    tasks: [
      task(1, 'Collect documents', 'جمع المستندات'),
      task(2, 'Confirm turnover threshold', 'التأكد من حد الإيرادات'),
      task(3, 'Create the EmaraTax account', 'إنشاء حساب إماراتاكس'),
      task(4, 'Submit the application', 'تقديم الطلب'),
      task(5, 'Receive the certificate', 'استلام الشهادة'),
    ],
    requiredDocuments: [
      needs('trade_licence'),
      needs('emirates_id'),
      needs('passport'),
      needs('memorandum'),
      needs('bank_letter', false),
      needs('tenancy_contract', false),
    ],
  },

  ct_registration: {
    code: 'ct_registration',
    nameEn: 'Corporation tax registration',
    nameAr: 'التسجيل في ضريبة الشركات',
    recurrence: 'once',
    deadline: { kind: 'days_from_start', days: 30 },
    tasks: [
      task(1, 'Collect documents', 'جمع المستندات'),
      task(2, 'Confirm the financial year', 'تحديد السنة المالية'),
      task(3, 'Submit the application', 'تقديم الطلب'),
      task(4, 'Receive the certificate', 'استلام الشهادة'),
    ],
    requiredDocuments: [
      needs('trade_licence'),
      needs('emirates_id'),
      needs('passport'),
      needs('memorandum'),
    ],
  },

  vat_return: {
    code: 'vat_return',
    nameEn: 'VAT return',
    nameAr: 'إقرار ضريبة القيمة المضافة',
    // Once per period, and the period is the client's own, because the FTA
    // staggers the cycles.
    recurrence: 'per_vat_period',
    deadline: { kind: 'vat_return' },
    tasks: [
      task(1, 'Request the period documents', 'طلب مستندات الفترة'),
      task(2, 'Process purchases and sales', 'معالجة المشتريات والمبيعات'),
      task(3, 'Reconcile the bank', 'مطابقة البنك'),
      task(4, 'Prepare the return', 'إعداد الإقرار'),
      task(5, 'Review with the client', 'المراجعة مع العميل'),
      task(6, 'File on EmaraTax', 'التقديم على إماراتاكس'),
      task(7, 'Confirm payment', 'تأكيد السداد'),
    ],
    requiredDocuments: [needs('vat_certificate')],
  },

  ct_return: {
    code: 'ct_return',
    nameEn: 'Corporation tax return',
    nameAr: 'إقرار ضريبة الشركات',
    recurrence: 'per_financial_year',
    deadline: { kind: 'ct_return' },
    tasks: [
      task(1, 'Close the year', 'إقفال السنة'),
      task(2, 'Prepare the financial statements', 'إعداد القوائم المالية'),
      task(3, 'Compute taxable income', 'احتساب الدخل الخاضع للضريبة'),
      task(4, 'Review with the client', 'المراجعة مع العميل'),
      task(5, 'File on EmaraTax', 'التقديم على إماراتاكس'),
    ],
    requiredDocuments: [needs('corporate_tax_certificate')],
  },

  monthly_accounting: {
    code: 'monthly_accounting',
    nameEn: 'Monthly accounting',
    nameAr: 'المحاسبة الشهرية',
    recurrence: 'monthly',
    deadline: { kind: 'days_from_start', days: 20 },
    tasks: [
      task(1, 'Collect the month documents', 'جمع مستندات الشهر'),
      task(2, 'Process purchase invoices', 'معالجة فواتير المشتريات'),
      task(3, 'Process sales invoices', 'معالجة فواتير المبيعات'),
      task(4, 'Reconcile the bank', 'مطابقة البنك'),
      task(5, 'Issue the reports', 'إصدار التقارير'),
    ],
    requiredDocuments: [needs('trade_licence', false)],
  },

  tax_profile_update: {
    code: 'tax_profile_update',
    nameEn: 'Tax profile update',
    nameAr: 'تحديث الملف الضريبي',
    // Raised when a licence or an identity document is renewed, so it recurs
    // in practice but never on a calendar.
    recurrence: 'once',
    deadline: { kind: 'days_from_start', days: 20 },
    tasks: [
      task(1, 'Identify what changed', 'تحديد التغيير'),
      task(2, 'Update on EmaraTax', 'التحديث على إماراتاكس'),
      task(3, 'Confirm the change', 'تأكيد التحديث'),
    ],
    requiredDocuments: [needs('trade_licence')],
  },

  deregistration: {
    code: 'deregistration',
    nameEn: 'Deregistration',
    nameAr: 'إلغاء التسجيل',
    recurrence: 'once',
    deadline: { kind: 'days_from_start', days: 20 },
    tasks: [
      task(1, 'Confirm eligibility', 'التأكد من الأهلية'),
      task(2, 'File outstanding returns', 'تقديم الإقرارات المتبقية'),
      task(3, 'Settle any liability', 'تسوية المستحقات'),
      task(4, 'Submit the application', 'تقديم الطلب'),
      task(5, 'Receive confirmation', 'استلام التأكيد'),
    ],
    requiredDocuments: [needs('trade_licence')],
  },

  vat_refund: {
    code: 'vat_refund',
    nameEn: 'VAT refund',
    nameAr: 'استرداد ضريبة القيمة المضافة',
    recurrence: 'once',
    deadline: { kind: 'manual' },
    tasks: [
      task(1, 'Confirm the refundable amount', 'تأكيد المبلغ القابل للاسترداد'),
      task(2, 'Prepare the supporting schedule', 'إعداد الجدول المؤيد'),
      task(3, 'Submit the claim', 'تقديم الطلب'),
      task(4, 'Answer the authority queries', 'الرد على استفسارات الهيئة'),
      task(5, 'Confirm receipt of the refund', 'تأكيد استلام المبلغ'),
    ],
    requiredDocuments: [needs('vat_certificate'), needs('bank_letter')],
  },

  penalty_waiver: {
    code: 'penalty_waiver',
    nameEn: 'Penalty waiver',
    nameAr: 'طلب إلغاء الغرامات',
    recurrence: 'once',
    // The authority sets its own timetable case by case.
    deadline: { kind: 'manual' },
    tasks: [
      task(1, 'Establish the grounds', 'تحديد المبررات'),
      task(2, 'Gather the evidence', 'جمع الأدلة'),
      task(3, 'Prepare the submission', 'إعداد الطلب'),
      task(4, 'Submit and follow up', 'التقديم والمتابعة'),
    ],
    requiredDocuments: [needs('trade_licence')],
  },

  emaratax_request: {
    code: 'emaratax_request',
    nameEn: 'EmaraTax request',
    nameAr: 'طلبات إماراتاكس',
    recurrence: 'once',
    deadline: { kind: 'manual' },
    tasks: [
      task(1, 'Clarify what is needed', 'تحديد المطلوب'),
      task(2, 'Submit the request', 'تقديم الطلب'),
      task(3, 'Follow up until answered', 'المتابعة حتى الرد'),
    ],
    requiredDocuments: [],
  },

  audit: {
    code: 'audit',
    nameEn: 'Audit',
    nameAr: 'التدقيق',
    recurrence: 'per_financial_year',
    deadline: { kind: 'manual' },
    tasks: [
      task(1, 'Agree the scope', 'الاتفاق على النطاق'),
      task(2, 'Collect the records', 'جمع السجلات'),
      task(3, 'Perform the fieldwork', 'تنفيذ أعمال التدقيق'),
      task(4, 'Issue the report', 'إصدار التقرير'),
    ],
    requiredDocuments: [needs('trade_licence'), needs('memorandum')],
  },
};

export const ALL_SERVICES = Object.values(SERVICE_TEMPLATES);

/**
 * The built-in template for a code, or undefined for anything else.
 *
 * Custom services live in the database and are found through the catalogue;
 * this answers only for the eleven in code, which is what the recurrence sweep
 * wants and nothing else does.
 */
export function templateFor(code: ServiceCode): ServiceTemplate | undefined {
  return Object.hasOwn(SERVICE_TEMPLATES, code)
    ? SERVICE_TEMPLATES[code as BuiltInServiceCode]
    : undefined;
}

/**
 * Whether a string names one of the firm's eleven services.
 *
 * Needed where a service code arrives from outside — a request body — because
 * `ServiceCode` is a compile-time type and a POST is not compiled.
 */
export function isServiceCode(value: string): value is BuiltInServiceCode {
  return Object.hasOwn(SERVICE_TEMPLATES, value);
}

/** The documents that block a project from starting, for this service. */
export function mandatoryDocumentsFor(code: ServiceCode): string[] {
  return (templateFor(code)?.requiredDocuments ?? [])
    .filter((document) => document.mandatory)
    .map((document) => document.type);
}
