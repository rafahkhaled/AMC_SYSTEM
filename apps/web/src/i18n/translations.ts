/**
 * Arabic first, because that is the working language (NFR-07). The English
 * accounting terms the firm already uses are kept in the Arabic text rather
 * than translated, because "VAT" and "TRN" are what people say in the office.
 */
export const translations = {
  ar: {
    appName: 'نظام إدارة أكتيف',
    signIn: {
      title: 'تسجيل الدخول',
      subtitle: 'نظام إدارة أعمال شركة أكتيف للاستشارات',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      submit: 'دخول',
      submitting: 'جارٍ الدخول…',
      emailRequired: 'أدخل البريد الإلكتروني',
      passwordRequired: 'أدخل كلمة المرور',
      failed: 'البيانات غير صحيحة',
      unavailable: 'تعذّر الاتصال بالخادم',
    },
    twoFactor: {
      title: 'رمز التحقق',
      subtitle: 'أدخل الرمز من تطبيق المصادقة',
      code: 'الرمز',
      submit: 'تحقق',
      failed: 'الرمز غير صحيح',
    },
    home: {
      welcome: 'أهلاً، {{name}}',
      role: 'الدور',
      permissions: 'الصلاحيات',
      recentActivity: 'آخر النشاطات',
      noActivity: 'لا توجد نشاطات',
      signOut: 'تسجيل الخروج',
    },
    roles: {
      manager: 'المدير',
      accountant: 'المحاسب',
      data_entry: 'إدخال البيانات',
      client: 'العميل',
    },
    language: 'English',
    loading: 'جارٍ التحميل…',
  },
  en: {
    appName: 'AMC System',
    signIn: {
      title: 'Sign in',
      subtitle: 'Active Management Consultancy',
      email: 'Email address',
      password: 'Password',
      submit: 'Sign in',
      submitting: 'Signing in…',
      emailRequired: 'Enter your email address',
      passwordRequired: 'Enter your password',
      failed: 'Those details are not right',
      unavailable: 'Could not reach the server',
    },
    twoFactor: {
      title: 'Verification code',
      subtitle: 'Enter the code from your authenticator app',
      code: 'Code',
      submit: 'Verify',
      failed: 'That code is not right',
    },
    home: {
      welcome: 'Welcome, {{name}}',
      role: 'Role',
      permissions: 'Permissions',
      recentActivity: 'Recent activity',
      noActivity: 'Nothing yet',
      signOut: 'Sign out',
    },
    roles: {
      manager: 'Manager',
      accountant: 'Accountant',
      data_entry: 'Data entry',
      client: 'Client',
    },
    language: 'العربية',
    loading: 'Loading…',
  },
} as const;

export type Language = keyof typeof translations;
export const LANGUAGES: Language[] = ['ar', 'en'];
