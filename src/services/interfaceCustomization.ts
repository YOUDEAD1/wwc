import type { Api } from 'grammy';
import { adminLabel } from '../platform/adminLocale.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Lang } from '../../config/index.js';
import { getDbScope } from '../db/db_context.js';
import { getTextOverride } from './settings.js';

const language = new AsyncLocalStorage<Lang>();
const observed = new Map<string, Map<string, string>>();
export function withInterfaceLanguage<T>(lang: Lang, fn: () => Promise<T>) {
  return language.run(lang, fn);
}
export function setInterfaceLanguage(lang: Lang) {
  language.enterWith(lang);
}
export function currentInterfaceLanguage() {
  return language.getStore() ?? 'en';
}
export function buttonId(data: string) {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}
export function observedButtons() {
  return observed.get(getDbScope()) ?? new Map<string, string>();
}
export function installInterfaceCustomization(api: Api) {
  api.config.use(async (prev, method, payload, signal) => {
    const lang = language.getStore() ?? 'en';
    const buttons = (payload as any).reply_markup?.inline_keyboard;
    if (buttons) {
      let known = observed.get(getDbScope());
      if (!known) {
        if (observed.size >= 200) observed.delete(observed.keys().next().value!);
        known = new Map();
        observed.set(getDbScope(), known);
      }
      for (const row of buttons)
        for (const button of row) {
          const action = button.callback_data ?? button.url;
          if (!action) continue;
          if (/^(uix:|adm:|guide:|super:)/.test(action)) button.text=adminLabel(button.text,lang);
          if (/^uix:/.test(action)) continue;
          const id = buttonId(action);
          if (known.size < 1500 || known.has(id)) known.set(id, button.text);
          const label = getTextOverride('interface.' + id, lang);
          if (label !== undefined) button.text = label;
          const icon = getTextOverride('interface_icon.' + id);
          if (icon) button.icon_custom_emoji_id = icon;
          else {
            const glyph = getTextOverride('interface_unicode.' + id);
            if (glyph) button.text = glyph + ' ' + button.text;
          }
          const style = getTextOverride('interface_style.' + id);
          if (style === 'default') delete button.style;
          else if (style && ['primary', 'success', 'danger'].includes(style)) button.style = style;
        }
    }
    return prev(method, payload, signal);
  });
}
