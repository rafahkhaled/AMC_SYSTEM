/**
 * Money on screen, from whole minor units.
 *
 * Never a float on the way in: the server sends fils and this divides once,
 * at the last moment, for the benefit of a human reader. Arithmetic on the
 * result is a bug — every figure shown here was already worked out on the
 * server, where the rounding rule lives.
 */
export function formatMoney(
  amount: { minorUnits: number; currency: string },
  language: string,
): string {
  return new Intl.NumberFormat(language === 'ar' ? 'ar-AE' : 'en-AE', {
    style: 'currency',
    currency: amount.currency,
    minimumFractionDigits: 2,
  }).format(amount.minorUnits / 100);
}

/** Hours as a person says them: 3.5h, not 12600 seconds. */
export function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(2)}h`;
}

/** The fils behind what somebody typed, without ever holding a float. */
export function minorUnitsFrom(typed: string): number | null {
  const cleaned = typed.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
