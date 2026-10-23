/**
 * Tiny i18n helper. Resolution order:
 *   1. Admin override from settings table (`text.<key>`)
 *   2. Locale string from config/locales/<lang>.ts
 *   3. English fallback
 *   4. The raw key (so missing strings are visible)
 *
 * Strings can use `{placeholder}` style interpolation.
 */
import { LOCALES, type Lang } from '../../config/index.js';
import { getTextOverride } from '../services/settings.js';
import { copyDefault, validCopy } from '../services/copyCatalog.js';

export function t(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  let override = getTextOverride(key, lang);
  if (
    override === 'Welcome to SafwanTiger Shop' ||
    override === 'Welcome to SafwanTiger Shop!' ||
    override === '🐯 *SafwanTiger Shop* — Main Menu' ||
    override === '🐯 *متجر SafwanTiger* — القائمة الرئيسية'
  ) {
    override = undefined;
  }
  const registered=copyDefault(lang,key);
  const fallback=LOCALES[lang]?.[key] ?? LOCALES.en[key] ?? registered ?? key;
  const tpl = override !== undefined && (registered===undefined || validCopy(override,fallback)) ? override : fallback;
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}
