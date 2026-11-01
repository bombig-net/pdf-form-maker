/** Regional formats for date, number and postal code fields. One setting per form. */
export type LocaleId = 'eu' | 'ch' | 'uk' | 'us';

export interface LocaleFormat {
  label: string;
  /** Acrobat date format (AFDate_*). */
  date: 'dd.mm.yyyy' | 'dd/mm/yyyy' | 'mm/dd/yyyy';
  /** Acrobat number separator style: 0 = 1,234.56 · 2 = 1.234,56 · 4 = 1'234.56 */
  sepStyle: 0 | 2 | 4;
  /** Locale for number formatting in test mode. */
  intl: string;
  numberExample: string;
  /** Characters allowed while typing a postal code. */
  zipKeys: string;
  /** Full postal code check. */
  zip: string;
  zipHint: string;
}

export const DEFAULT_LOCALE: LocaleId = 'eu';

export const LOCALES: Record<LocaleId, LocaleFormat> = {
  eu: { label: 'Europe', date: 'dd.mm.yyyy', sepStyle: 2, intl: 'de-DE', numberExample: '1.234,56', zipKeys: '^[0-9]*$', zip: '^[0-9]{4,5}$', zipHint: 'Digits only, 4\u20135 characters.' },
  ch: { label: 'Switzerland', date: 'dd.mm.yyyy', sepStyle: 4, intl: 'de-CH', numberExample: "1'234.56", zipKeys: '^[0-9]*$', zip: '^[0-9]{4}$', zipHint: 'Four digits.' },
  uk: { label: 'United Kingdom', date: 'dd/mm/yyyy', sepStyle: 0, intl: 'en-GB', numberExample: '1,234.56', zipKeys: '^[A-Za-z0-9 ]*$', zip: '^[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}$', zipHint: 'UK postcode, e.g. SW1A 1AA.' },
  us: { label: 'United States', date: 'mm/dd/yyyy', sepStyle: 0, intl: 'en-US', numberExample: '1,234.56', zipKeys: '^[0-9-]*$', zip: '^[0-9]{5}(-[0-9]{4})?$', zipHint: 'ZIP code, 12345 or 12345-6789.' },
};

export const locale = (id?: string): LocaleFormat => LOCALES[(id as LocaleId) in LOCALES ? (id as LocaleId) : DEFAULT_LOCALE];

/** Date pattern for people, e.g. DD.MM.YYYY. */
export const datePattern = (l: LocaleFormat) => l.date.toUpperCase();

/** Parses a date in the locale's order; returns the normalized text or null if invalid. */
export function normalizeDate(input: string, l: LocaleFormat): string | null {
  const sep = l.date.includes('/') ? '/' : '.';
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(input.trim());
  if (!m) return null;
  const [a, b] = [+m[1], +m[2]];
  const [day, month] = l.date.startsWith('mm') ? [b, a] : [a, b];
  const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const d = new Date(year, month - 1, day);
  if (d.getDate() !== day || d.getMonth() !== month - 1) return null;
  const dd = String(day).padStart(2, '0'), mm = String(month).padStart(2, '0');
  return (l.date.startsWith('mm') ? [mm, dd, year] : [dd, mm, year]).join(sep);
}

/** Parses a number typed in any common notation; returns NaN if invalid. */
export function parseNumber(input: string, l: LocaleFormat): number {
  let v = input.trim().replace(/['\s]/g, '');
  if (l.sepStyle === 2) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(/,/g, '');
  return v === '' ? NaN : Number(v);
}
