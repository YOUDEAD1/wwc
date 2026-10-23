/**
 * نظام الاشتراك الإجباري
 * - الأدمن يتحكم من لوحة التحكم بالأزرار
 * - المستخدم لا يدخل البوت إلا بعد الاشتراك
 * - الإحالة لا تُحسب إلا بعد الاشتراك
 */

import { InlineKeyboard, type Api } from 'grammy';
import { supabase } from '../db/supabase.js';
import { t } from '../i18n/index.js';
import { logger } from '../logger.js';
import { del, get, remember, set } from './cache.js';
import { currentInterfaceLanguage } from './interfaceCustomization.js';
import { refreshSettings } from './settings.js';

export function normalizeChannelIdentifier(channel: string): string | number {
  const trimmed = channel.trim();
  if (trimmed.startsWith('-') || /^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed.startsWith('@')) {
    return trimmed;
  }
  if (trimmed.includes('t.me/')) {
    const after = trimmed.split('t.me/')[1]?.trim();
    if (after && !after.startsWith('+') && !after.startsWith('joinchat/')) {
      return `@${after.replace(/^@/, '')}`;
    }
  }
  return trimmed;
}

const linkCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function resolveChannelLink(api: Api, channelStr: string): Promise<string> {
  const trimmed = channelStr.trim();

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('t.me/')) {
    return `https://${trimmed}`;
  }

  const cached = linkCache.get(trimmed);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.url;
  }

  if (trimmed.startsWith('@')) {
    const url = `https://t.me/${trimmed.slice(1)}`;
    linkCache.set(trimmed, { url, timestamp: Date.now() });
    return url;
  }

  try {
    const targetChatId = normalizeChannelIdentifier(trimmed);
    const chat = await api.getChat(targetChatId);

    let url: string | null = null;
    if (chat.username) {
      url = `https://t.me/${chat.username}`;
    } else if (chat.invite_link) {
      url = chat.invite_link;
    } else {
      try {
        url = await api.exportChatInviteLink(chat.id);
      } catch {
        /* ignore export failure */
      }
    }

    if (url) {
      linkCache.set(trimmed, { url, timestamp: Date.now() });
      return url;
    }
  } catch (err) {
    logger.warn({ err, channelStr }, 'forceSub: resolveChannelLink getChat failed');
  }

  const cleanNum = trimmed.replace('-100', '').replace('-', '');
  if (/^\d+$/.test(cleanNum)) {
    return `https://t.me/c/${cleanNum}`;
  }
  return `https://t.me/${trimmed.replace(/^@/, '')}`;
}

export async function buildForceSubKeyboard(api: Api, channels: string[]): Promise<InlineKeyboard> {
  const kb = new InlineKeyboard();
  let idx = 1;
  for (const ch of channels) {
    const channelLink = await resolveChannelLink(api, ch);
    kb.url(t(currentInterfaceLanguage(), 'fsub.join', { number: idx++ }), channelLink).row();
  }
  kb.text(t(currentInterfaceLanguage(), 'fsub.check'), 'forcesub:check');
  return kb;
}

export async function getForceSub(): Promise<{
  enabled: boolean;
  channelId: string | null;
  channels: string[];
  message: string | null;
}> {
  return remember('force-sub-config', 15000, async () => {
    const { data } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', [
        'force_sub.enabled',
        'force_sub.channel_id',
        'fsub.channel_id',
        'fsub.message',
        'fsub.channels',
      ]);

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
  });
}

export async function setForceSubEnabled(enabled: boolean): Promise<void> {
  await supabase.from('settings').upsert({ key: 'force_sub.enabled', value: enabled });
  del('force-sub-config');
  await refreshSettings();
}

export async function setForceSubChannel(channelId: string): Promise<void> {
  await supabase.from('settings').upsert({ key: 'fsub.channel_id', value: channelId });
  await supabase.from('settings').upsert({ key: 'force_sub.channel_id', value: channelId });
  del('force-sub-config');
  await refreshSettings();
}

export async function checkUserSubscribed(
  api: Api,
  userId: number,
  channelId: string,
): Promise<boolean> {
  const key = 'member:' + userId + ':' + channelId;
  const cached = get<boolean>(key);
  if (cached !== undefined) return cached;
  try {
    const member = await api.getChatMember(normalizeChannelIdentifier(channelId), userId);
    const pass =
      ['member', 'administrator', 'creator'].includes(member.status) ||
      (member.status === 'restricted' && member.is_member);
    set(key, pass, pass ? 45000 : 5000);
    return pass;
  } catch (err) {
    logger.warn({ userId, channelId }, 'Membership check unavailable');
    set(key, false, 3000);
    return false;
  }
}

export async function enforceSubscription(
  api: Api,
  userId: number,
): Promise<
  { pass: true } | { pass: false; channelId: string; channels: string[]; message: string }
> {
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
    message:
      (config.message && !/[\u0600-\u06ff]/.test(config.message)) ||
      currentInterfaceLanguage() === 'ar'
        ? (config.message ?? t(currentInterfaceLanguage(), 'fsub.required'))
        : t(currentInterfaceLanguage(), 'fsub.required'),
  };
}

export async function invalidateReferral(api: Api, userId: number): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ pending_referral_by: null, referral_invalidated: true })
    .eq('telegram_id', userId)
    .eq('sub_verified', false);
  if (error) throw error;
}
