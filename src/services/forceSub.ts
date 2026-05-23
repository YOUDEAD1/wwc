/**
 * نظام الاشتراك الإجباري
 * - الأدمن يتحكم من لوحة التحكم بالأزرار
 * - المستخدم لا يدخل البوت إلا بعد الاشتراك
 * - الإحالة لا تُحسب إلا بعد الاشتراك
 */

import type { Api } from 'grammy';
import { supabase } from '../db/supabase.js';
import { logger } from '../logger.js';

export async function getForceSub(): Promise<{
  enabled: boolean;
  channelId: string | null;
  message: string | null;
}> {
  const { data } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['force_sub.enabled', 'force_sub.channel_id', 'fsub.channel_id', 'fsub.message']);

  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));

  // يدعم المفتاحين القديم والجديد
  const channelId =
    (typeof map['fsub.channel_id'] === 'string' ? map['fsub.channel_id'] : null) ??
    (typeof map['force_sub.channel_id'] === 'string' ? map['force_sub.channel_id'] : null);

  return {
    enabled: map['force_sub.enabled'] === true,
    channelId,
    message: typeof map['fsub.message'] === 'string' ? map['fsub.message'] : null,
  };
}

export async function setForceSubEnabled(enabled: boolean): Promise<void> {
  await supabase.from('settings').upsert({ key: 'force_sub.enabled', value: enabled });
}

export async function setForceSubChannel(channelId: string): Promise<void> {
  await supabase.from('settings').upsert({ key: 'fsub.channel_id', value: channelId });
  await supabase.from('settings').upsert({ key: 'force_sub.channel_id', value: channelId });
}

export async function checkUserSubscribed(
  api: Api,
  userId: number,
  channelId: string,
): Promise<boolean> {
  try {
    const member = await api.getChatMember(channelId, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    logger.warn({ err, userId, channelId }, 'forceSub: getChatMember failed — allowing user');
    return true;
  }
}

export async function enforceSubscription(
  api: Api,
  userId: number,
): Promise<{ pass: true } | { pass: false; channelId: string; message: string }> {
  const config = await getForceSub();
  if (!config.enabled || !config.channelId) return { pass: true };

  const subscribed = await checkUserSubscribed(api, userId, config.channelId);
  if (subscribed) return { pass: true };

  const defaultMessage =
    '⛔ *الاشتراك مطلوب*\n\n' +
    'يجب الاشتراك في قناتنا أولاً للوصول إلى البوت.\n\n' +
    '1️⃣ اضغط *اشترك في القناة*\n' +
    '2️⃣ اضغط *اشتركت، تحقق الآن*';

  return {
    pass: false,
    channelId: config.channelId,
    message: config.message ?? defaultMessage,
  };
}