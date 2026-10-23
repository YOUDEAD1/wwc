import { supabase } from '../db/supabase.js';

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterMs: number };

export async function consume(
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc('consume_rate_limit', {
    p_key: key,
    p_max: max,
    p_window_ms: windowMs,
  });
  if (error) throw error;
  return data as RateLimitResult;
}

export function formatRetryAfter(retryAfterMs: number): string {
  const s = Math.ceil(retryAfterMs / 1000);
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)}m`;
}
