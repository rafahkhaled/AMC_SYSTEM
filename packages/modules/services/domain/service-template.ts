/**
 * The eleven services the practice sells (FR-10).
 *
 * Defined in code rather than as rows, because each one carries a deadline
 * rule and a recurrence that the engine has to understand. A row in a table
 * cannot say "nine months after the client's financial year ends"; it can only
 * say a number that some code then interprets, and then the meaning lives in
 * two places.
 */
export type ServiceCode =
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

export interface TemplateStep {
  readonly order: number;
  readonly nameEn: string;
  readonly nameAr: string;
}

export interface RequiredDocument {
  readonly type: string;
  /**
   * Mandatory documents gate the work: a task cannot start without them
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
  readonly steps: readonly TemplateStep[];
  readonly requiredDocuments: readonly RequiredDocument[];
}

const step = (order: number, nameEn: string, nameAr: string): TemplateStep => ({
  order,
  nameEn,
  nameAr,
});

const needs = (type: string, mandatory = true): RequiredDocument => ({ type, mandatory });

export const SERVICE_TEMPLATES: Readonly<Record<ServiceCode, ServiceTemplate>> = {
  vat_registration: {
    code: 'vat_registration',
    nameEn: 'VAT registration',
    nameAr: 'التسجيل في ضريبة القيمة المضافة',
    recurrence: 'once',
    deadline: { kind: 'days_from_start', days: 30 },
    steps: [
      step(1, 'Collect documents', 'جمع المستندات'),
      step(2, 'Confirm turnover threshold', 'التأكد من حد الإيرادات'),
      step(3, 'Create the EmaraTax account', 'إنشاء حساب إماراتاكس'),
      step(4, 'Submit the application', 'تقديم الطلب'),
      step(5, 'Receive the certificate', 'استلام الشهادة'),
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
    steps: [
      step(1, 'Collect documents', 'جمع المستندات'),
      step(2, 'Confirm the financial year', 'تحديد السنة المالية'),
      step(3, 'Submit the application', 'تقديم الطلب'),
      step(4, 'Receive the certificate', 'استلام الشهادة'),
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
    steps: [
      step(1, 'Request the period documents', 'طلب مستندات الفترة'),
      step(2, 'Process purchases and sales', 'معالجة المشتريات والمبيعات'),
      step(3, 'Reconcile the bank', 'مطابقة البنك'),
      step(4, 'Prepare the return', 'إعداد الإقرار'),
      step(5, 'Review with the client', 'المراجعة مع العميل'),
      step(6, 'File on EmaraTax', 'التقديم على إماراتاكس'),
      step(7, 'Confirm payment', 'تأكيد السداد'),
    ],
    requiredDocuments: [needs('vat_certificate')],
  },

  ct_return: {
    code: 'ct_return',
    nameEn: 'Corporation tax return',
    nameAr: 'إقرار ضريبة الشركات',
    recurrence: 'per_financial_year',
    deadline: { kind: 'ct_return' },
    steps: [
      step(1, 'Close the year', 'إقفال السنة'),
      step(2, 'Prepare the financial statements', 'إعداد القوائم المالية'),
      step(3, 'Compute taxable income', 'احتساب الدخل الخاضع للضريبة'),
      step(4, 'Review with the client', 'المراجعة مع العميل'),
      step(5, 'File on EmaraTax', 'التقديم على إماراتاكس'),
    ],
    requiredDocuments: [needs('corporate_tax_certificate')],
  },

  monthly_accounting: {
    code: 'monthly_accounting',
    nameEn: 'Monthly accounting',
    nameAr: 'المحاسبة الشهرية',
    recurrence: 'monthly',
    deadline: { kind: 'days_from_start', days: 20 },
    steps: [
      step(1, 'Collect the month documents', 'جمع مستندات الشهر'),
      step(2, 'Process purchase invoices', 'معالجة فواتير المشتريات'),
      step(3, 'Process sales invoices', 'معالجة فواتير المبيعات'),
      step(4, 'Reconcile the bank', 'مطابقة البنك'),
      step(5, 'Issue the reports', 'إصدار التقارير'),
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
    steps: [
      step(1, 'Identify what changed', 'تحديد التغيير'),
      step(2, 'Update on EmaraTax', 'التحديث على إماراتاكس'),
      step(3, 'Confirm the change', 'تأكيد التحديث'),
    ],
    requiredDocuments: [needs('trade_licence')],
  },

  deregistration: {
    code: 'deregistration',
    nameEn: 'Deregistration',
    nameAr: 'إلغاء التسجيل',
    recurrence: 'once',
    deadline: { kind: 'days_from_start', days: 20 },
    steps: [
      step(1, 'Confirm eligibility', 'التأكد من الأهلية'),
      step(2, 'File outstanding returns', 'تقديم الإقرارات المتبقية'),
      step(3, 'Settle any liability', 'تسوية المستحقات'),
      step(4, 'Submit the application', 'تقديم الطلب'),
      step(5, 'Receive confirmation', 'استلام التأكيد'),
    ],
    requiredDocuments: [needs('trade_licence')],
  },

  vat_refund: {
    code: 'vat_refund',
    nameEn: 'VAT refund',
    nameAr: 'استرداد ضريبة القيمة المضافة',
    recurrence: 'once',
    deadline: { kind: 'manual' },
    steps: [
      step(1, 'Confirm the refundable amount', 'تأكيد المبلغ القابل للاسترداد'),
      step(2, 'Prepare the supporting schedule', 'إعداد الجدول المؤيد'),
      step(3, 'Submit the claim', 'تقديم الطلب'),
      step(4, 'Answer the authority queries', 'الرد على استفسارات الهيئة'),
      step(5, 'Confirm receipt of the refund', 'تأكيد استلام المبلغ'),
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
    steps: [
      step(1, 'Establish the grounds', 'تحديد المبررات'),
      step(2, 'Gather the evidence', 'جمع الأدلة'),
      step(3, 'Prepare the submission', 'إعداد الطلب'),
      step(4, 'Submit and follow up', 'التقديم والمتابعة'),
    ],
    requiredDocuments: [needs('trade_licence')],
  },

  emaratax_request: {
    code: 'emaratax_request',
    nameEn: 'EmaraTax request',
    nameAr: 'طلبات إماراتاكس',
    recurrence: 'once',
    deadline: { kind: 'manual' },
    steps: [
      step(1, 'Clarify what is needed', 'تحديد المطلوب'),
      step(2, 'Submit the request', 'تقديم الطلب'),
      step(3, 'Follow up until answered', 'المتابعة حتى الرد'),
    ],
    requiredDocuments: [],
  },

  audit: {
    code: 'audit',
    nameEn: 'Audit',
    nameAr: 'التدقيق',
    recurrence: 'per_financial_year',
    deadline: { kind: 'manual' },
    steps: [
      step(1, 'Agree the scope', 'الاتفاق على النطاق'),
      step(2, 'Collect the records', 'جمع السجلات'),
      step(3, 'Perform the fieldwork', 'تنفيذ أعمال التدقيق'),
      step(4, 'Issue the report', 'إصدار التقرير'),
    ],
    requiredDocuments: [needs('trade_licence'), needs('memorandum')],
  },
};

export const ALL_SERVICES = Object.values(SERVICE_TEMPLATES);

export function templateFor(code: ServiceCode): ServiceTemplate {
  return SERVICE_TEMPLATES[code];
}

/** The documents that block a task from starting, for this service. */
export function mandatoryDocumentsFor(code: ServiceCode): string[] {
  return SERVICE_TEMPLATES[code].requiredDocuments
    .filter((document) => document.mandatory)
    .map((document) => document.type);
}
