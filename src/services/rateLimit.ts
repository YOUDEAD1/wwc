import { supabase } from '../db/supabase.js';

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number };

export async function consume(
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const resetAt = new Date(Date.now() + windowMs).toISOString();

  const { data: existing } = await supabase
    .from('rate_limits')
    .select('count, reset_at')
    .eq('key', key)
    .maybeSingle();

  if (!existing || new Date(existing.reset_at) <= now) {
    await supabase.from('rate_limits').upsert({ key, count: 1, reset_at: resetAt });
    return { ok: true, remaining: max - 1 };
  }

  if (existing.count >= max) {
    return { ok: false, retryAfterMs: new Date(existing.reset_at).getTime() - Date.now() };
  }

  await supabase.from('rate_limits').update({ count: existing.count + 1 }).eq('key', key);
  return { ok: true, remaining: max - (existing.count + 1) };
}

export function formatRetryAfter(retryAfterMs: number): string {
  const s = Math.ceil(retryAfterMs / 1000);
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)}m`;
}