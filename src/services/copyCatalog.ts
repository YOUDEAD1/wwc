/** Pure registry: safe to import in the headless controller without bot env. */
import type { Lang } from '../../config/index.js';
export type CopyEntry = {
  key: string;
  defaults: Record<Lang, string>;
  button: boolean;
  folder: number;
};
const registry = new Map<string, CopyEntry>();
export function registerCopy(entry: CopyEntry) {
  registry.set(entry.key, entry);
}
export function copyEntries() { return [...registry.values()]; }
export function copyEntry(key: string) { return registry.get(key); }
export function copyDefault(lang: Lang, key: string) {
  const entry=registry.get(key);return entry?.defaults[lang] ?? entry?.defaults.en;
}
export function requiredFields(text: string) {
  return [...new Set(text.match(/\{\w+\}/g) ?? [])];
}
export function validCopy(value: string, fallback: string) {
  const expected=requiredFields(fallback),actual=requiredFields(value);
  return Boolean(value.trim()) && expected.every(k=>actual.includes(k)) && actual.every(k=>expected.includes(k));
}
