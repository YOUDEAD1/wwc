import type { SessionData } from '../middleware/session.js';
export const persistentSessions = {
  async read(key: string): Promise<SessionData | undefined> {
    const { supabase } = await import('../db/supabase.js');
    const { data, error } = await supabase
      .from('wwc_shop_sessions')
      .select('value,expires_at')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    return data && Date.parse(data.expires_at) > Date.now()
      ? (data.value as SessionData)
      : undefined;
  },
  async write(key: string, value: SessionData) {
    if (Buffer.byteLength(JSON.stringify(value)) > 131072) throw Error('SESSION_TOO_LARGE');
    const { supabase } = await import('../db/supabase.js');
    const { error } = await supabase
      .from('wwc_shop_sessions')
      .upsert(
        { key, value, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() },
        { onConflict: 'key' },
      );
    if (error) throw error;
  },
  async delete(key: string) {
    const { supabase } = await import('../db/supabase.js');
    const { error } = await supabase.from('wwc_shop_sessions').delete().eq('key', key);
    if (error) throw error;
  },
};
