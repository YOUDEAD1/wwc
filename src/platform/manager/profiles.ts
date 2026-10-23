import type { Registry } from '../repository.js';
import { seal, unseal, PlatformError } from '../security.js';
import type { Language } from './content.js';
export type Draft = { step: string; [key: string]: any };
export type Profile = {
  telegram_id: number;
  language: Language;
  language_chosen: boolean;
  draft_box?: string | null;
  draft_expires_at?: string | null;
  updated_at?: string;
};
export class ManagerProfiles {
  private cache = new Map<number, { value: Profile; until: number }>();
  constructor(private registry: Registry) {}
  async get(uid: number) {
    const cached = this.cache.get(uid);
    if (cached && cached.until > Date.now()) return { ...cached.value };
    const { data, error } = await this.registry.db
      .from('wwc_manager_users')
      .select('*')
      .eq('telegram_id', uid)
      .maybeSingle();
    if (error) throw new PlatformError(503, 'RUN_PLATFORM_SQL_FIRST');
    const p = (data ?? { telegram_id: uid, language: 'en', language_chosen: false }) as Profile;
    if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(uid, { value: p, until: Date.now() + 60000 });
    return { ...p };
  }
  async save(p: Profile) {
    const { error } = await this.registry.db
      .from('wwc_manager_users')
      .upsert({ ...p, updated_at: new Date().toISOString() }, { onConflict: 'telegram_id' });
    if (error) throw new PlatformError(503, 'PROFILE_UNAVAILABLE');
    p.updated_at = new Date().toISOString();
    this.cache.set(p.telegram_id, { value: { ...p }, until: Date.now() + 60000 });
  }
  draft(p: Profile): Draft | null {
    if (!p.draft_box || Date.parse(p.draft_expires_at ?? '') <= Date.now()) return null;
    try {
      return unseal<Draft>(
        p.draft_box,
        this.registry.config.encryptionKey,
        'manager:' + p.telegram_id,
      );
    } catch {
      return null;
    }
  }
  async setDraft(p: Profile, draft: Draft | null) {
    const saved = this.cache.get(p.telegram_id)?.value;
    if (
      !draft &&
      !p.draft_box &&
      !p.draft_expires_at &&
      p.updated_at &&
      saved?.language === p.language &&
      saved?.language_chosen === p.language_chosen
    )
      return;
    p.draft_box = draft
      ? seal(draft, this.registry.config.encryptionKey, 'manager:' + p.telegram_id)
      : null;
    p.draft_expires_at = draft ? new Date(Date.now() + 1200000).toISOString() : null;
    await this.save(p);
  }
}
