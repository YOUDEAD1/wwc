/**
 * نظام الاشتراك الإجباري
 * - الأدمن يتحكم من لوحة التحكم بالأزرار
 * - المستخدم لا يدخل البوت إلا بعد الاشتراك
 * - الإحالة لا تُحسب إلا بعد الاشتراك
 */

import type { Api } from 'grammy';
import { supabase } from '../db/supabase.js';
import { logger } from '../logger.js';
import { refreshSettings } from './settings.js';

export async function getForceSub(): Promise<{
  enabled: boolean;
  channelId: string | null;
  channels: string[];
  message: string | null;
}> {
  const { data } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['force_sub.enabled', 'force_sub.channel_id', 'fsub.channel_id', 'fsub.message', 'fsub.channels']);

  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));

  // يدعم المفتاحين القديم والجديد
  const channelId =
    (typeof map['fsub.channel_id'] === 'string' ? map['fsub.channel_id'] : null) ??
    (typeof map['force_sub.channel_id'] === 'string' ? map['force_sub.channel_id'] : null);

  let channels: string[] = [];
  if (Array.isArray(map['fsub.channels'])) {
    channels = map['fsub.channels'].filter((x) => typeof x === 'string');
  } else if (typeof map['fsub.channels'] === 'string') {
    try {
      const parsed = JSON.parse(map['fsub.channels']);
      if (Array.isArray(parsed)) {
        channels = parsed.filter((x) => typeof x === 'string');
      }
    } catch {
      // ignore
    }
  }

  if (channels.length === 0 && channelId) {
    channels = [channelId];
  }

  return {
    enabled: map['force_sub.enabled'] === true,
    channelId,
    channels,
    message: typeof map['fsub.message'] === 'string' ? map['fsub.message'] : null,
  };
}

export async function setForceSubEnabled(enabled: boolean): Promise<void> {
  await supabase.from('settings').upsert({ key: 'force_sub.enabled', value: enabled });
  await refreshSettings();
}

export async function setForceSubChannel(channelId: string): Promise<void> {
  await supabase.from('settings').upsert({ key: 'fsub.channel_id', value: channelId });
  await supabase.from('settings').upsert({ key: 'force_sub.channel_id', value: channelId });
  await refreshSettings();
}

export async function checkUserSubscribed(
  api: Api,
  userId: number,
  channelId: string,
): Promise<boolean> {
  try {
    const targetChatId = channelId.startsWith('@') ? channelId : Number(channelId);
    const member = await api.getChatMember(targetChatId, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    logger.warn({ err, userId, channelId }, 'forceSub: getChatMember failed — denying user');
    return false;
  }
}

export async function enforceSubscription(
  api: Api,
  userId: number,
): Promise<{ pass: true } | { pass: false; channelId: string; channels: string[]; message: string }> {
  const config = await getForceSub();
  if (!config.enabled || !config.channels || config.channels.length === 0) {
    return { pass: true };
  }

  const unsubscribed: string[] = [];
  for (const channel of config.channels) {
    const isSub = await checkUserSubscribed(api, userId, channel);
    if (!isSub) {
      unsubscribed.push(channel);
    }
  }

  if (unsubscribed.length === 0) {
    return { pass: true };
  }

  const defaultMessage =
    '⛔ *الاشتراك مطلوب*\n\n' +
    'يجب الاشتراك في قناتنا أولاً للوصول إلى البوت.\n\n' +
    'بعد الاشتراك بنجاح في جميع القنوات، اضغط على زر التحقق.';

  return {
    pass: false,
    channelId: unsubscribed[0] || '',
    channels: unsubscribed,
    message: config.message ?? defaultMessage,
  };
}

export async function invalidateReferral(api: Api, userId: number): Promise<void> {
  const { data: referral } = await supabase
    .from('referrals')
    .select('referrer_id')
    .eq('referee_id', userId)
    .maybeSingle();

  if (!referral) return;

  const referrerId = referral.referrer_id;

  // 1. Delete the referral row
  const { error: delErr } = await supabase
    .from('referrals')
    .delete()
    .eq('referee_id', userId);

  if (delErr) {
    logger.error({ err: delErr, userId }, 'invalidateReferral: failed to delete referral row');
    return;
  }

  logger.info({ userId, referrerId }, 'invalidateReferral: referral deleted successfully');

  // 2. Fetch new balance of referrer
  const { getReferralBalance } = await import('../db/queries.js');
  const { getReferralCost, getReferralAmount } = await import('./settings.js');
  const refBalance = await getReferralBalance(referrerId);
  if (refBalance.available < 0) {
    const deficit = Math.abs(refBalance.available);
    const cost = getReferralCost();
    const amount = getReferralAmount();
    const penaltyAmount = deficit * (amount / cost);

    logger.info(
      { referrerId, deficit, penaltyAmount },
      'invalidateReferral: referrer has negative refs balance, applying penalty debit'
    );

    // 3. Deduct wallet balance of referrer
    const { data: user } = await supabase
      .from('users')
      .select('balance, referral_earned_total, referral_transferred')
      .eq('telegram_id', referrerId)
      .single();

    const currentBalance = Number(user?.balance ?? 0);
    const newBalance = Math.max(0, currentBalance - penaltyAmount);

    const currentEarned = Number(user?.referral_earned_total ?? 0);
    const newEarned = Math.max(0, currentEarned - penaltyAmount);

    const currentTransferred = Number(user?.referral_transferred ?? 0);
    const newTransferred = Math.max(0, currentTransferred - penaltyAmount);

    await supabase
      .from('users')
      .update({
        balance: newBalance,
        referral_earned_total: newEarned,
        referral_transferred: newTransferred,
      })
      .eq('telegram_id', referrerId);

    // 4. Record wallet ledger entry
    await supabase.from('wallet_ledger').insert({
      user_id: referrerId,
      type: 'debit',
      amount: -penaltyAmount,
      reference: 'referral_unsub_penalty',
    });

    // 5. Insert negative referral conversion row to restore available refs back to 0
    await supabase.from('referral_conversions').insert({
      user_id: referrerId,
      refs_spent: -deficit,
      amount: -penaltyAmount,
    });
    
    // Notify referrer if possible
    try {
      await api.sendMessage(
        referrerId,
        `⚠️ *تنبيه خصم إحالة*\n\n` +
          `قام أحد المستخدمين الذين دعوتهم بإلغاء الاشتراك في القناة الإلزامية.\n` +
          `تم خصم *${penaltyAmount.toFixed(2)} USDT* من رصيدك وسحب *${deficit} إحالة* بسبب مغادرة العضو القناة.`,
        { parse_mode: 'Markdown' }
      );
    } catch { /* ignore */ }
  }
}