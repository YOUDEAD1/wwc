import type { Composer } from 'grammy';
import { type Lang } from '../../config/index.js';
import {
  countReferrals,
  listDeposits,
  listOrders,
  setClickSound,
  setUserLanguage,
  toggleClickSoundButton,
  toggleNotification,
} from '../db/queries.js';
import * as cache from '../services/cache.js';
import { buildDeletable } from '../services/messageTracker.js';
import {
  CLICK_SOUND_BUTTON_KEYS,
  type ClickSoundButtonKey,
} from '../services/clickSound.js';
import {
  clickSoundLabel,
  clickSoundsKeyboard,
  profileKeyboard,
  notificationsKeyboard,
  languageKeyboard,
} from '../keyboards/profile.js';
import type { AppCtx } from '../middleware/user.js';
import { env } from '../env.js';
import { logger } from '../logger.js';

function profileText(ctx: AppCtx): string {
  const joined = new Date(ctx.user.joined_at).toISOString().slice(0, 10);
  return [
    ctx.t('profile.title'),
    '',
    ctx.t('profile.user_id', { id: ctx.user.telegram_id }),
    ctx.user.username ? ctx.t('profile.username', { username: ctx.user.username }) : '',
    ctx.t('profile.balance', { balance: ctx.user.balance }),
    ctx.t('profile.language', { language: ctx.lang.toUpperCase() }),
    ctx.t('profile.joined', { joined }),
  ]
    .filter(Boolean)
    .join('\n');
}

async function showProfile(ctx: AppCtx) {
  const text = profileText(ctx);
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard(ctx.lang),
    });
  } else {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard(ctx.lang),
    });
  }
}

function notificationsText(ctx: AppCtx): string {
  return [ctx.t('profile.notifications.title'), '', ctx.t('profile.notifications.body')].join('\n');
}

async function showNotifications(ctx: AppCtx) {
  await ctx.editMessageText(notificationsText(ctx), {
    parse_mode: 'Markdown',
    reply_markup: notificationsKeyboard(ctx.lang, {
      stock_alert: ctx.user.stock_alert,
      announcements: ctx.user.announcements,
    }),
  });
}

export function registerProfile(bot: Composer<AppCtx>): void {
  bot.callbackQuery('profile:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProfile(ctx);
  });

  // ---- Orders ----
  bot.callbackQuery('profile:orders', async (ctx) => {
    await ctx.answerCallbackQuery();
    const orders = await listOrders(ctx.user.telegram_id);
    if (orders.length === 0) {
      await ctx.editMessageText(ctx.t('profile.orders.empty'), {
        reply_markup: profileKeyboard(ctx.lang),
      });
      return;
    }
    const lines = [ctx.t('profile.orders.title'), ''];
    for (const o of orders) {
      lines.push(
        ctx.t('profile.orders.line', {
          id: o.id,
          name: o.product_name,
          qty: o.qty,
          total: o.total,
          date: o.created_at.slice(0, 10),
        }),
      );
    }
    await ctx.editMessageText(lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard(ctx.lang),
    });
  });

  // ---- Refer ----
  bot.callbackQuery('profile:refer', async (ctx) => {
    await ctx.answerCallbackQuery();
    const code = ctx.user.ref_code ?? `R${ctx.user.telegram_id.toString(36).toUpperCase()}`;
    const link = `https://t.me/${env.BOT_USERNAME}?start=${code}`;
    const count = await countReferrals(ctx.user.telegram_id);
    await ctx.editMessageText(
      `${ctx.t('profile.refer.title')}\n\n${ctx.t('profile.refer.body', { link, count })}`,
      {
        parse_mode: 'Markdown',
        reply_markup: profileKeyboard(ctx.lang),
      },
    );
  });

  // ---- Notifications submenu ----
  bot.callbackQuery('profile:notifications', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showNotifications(ctx);
  });

  bot.callbackQuery('profile:toggle_stock', async (ctx) => {
    const next = await toggleNotification(ctx.user.telegram_id, 'stock_alert');
    ctx.user.stock_alert = next;
    await ctx.answerCallbackQuery({
      text: next ? ctx.t('profile.notify.stock_on') : ctx.t('profile.notify.stock_off'),
    });
    await showNotifications(ctx);
  });

  bot.callbackQuery('profile:toggle_ann', async (ctx) => {
    const next = await toggleNotification(ctx.user.telegram_id, 'announcements');
    ctx.user.announcements = next;
    await ctx.answerCallbackQuery({
      text: next ? ctx.t('profile.notify.ann_on') : ctx.t('profile.notify.ann_off'),
    });
    await showNotifications(ctx);
  });

  // ---- Click sounds ----
  bot.callbackQuery('profile:click_sound', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      [ctx.t('click_sounds.title'), '', ctx.t('click_sounds.body')].join('\n'),
      {
        parse_mode: 'Markdown',
        reply_markup: clickSoundsKeyboard(ctx.lang, {
          master: ctx.user.click_sound !== false,
          off: Array.isArray(ctx.user.click_sound_off) ? ctx.user.click_sound_off : [],
        }),
      },
    );
  });

  bot.callbackQuery('profile:click_sound:master', async (ctx) => {
    const next = !(ctx.user.click_sound !== false);
    await setClickSound(ctx.user.telegram_id, next);
    ctx.user.click_sound = next;
    await ctx.answerCallbackQuery({
      text: next
        ? ctx.t('click_sounds.toast.master_on')
        : ctx.t('click_sounds.toast.master_off'),
    });
    await ctx.editMessageReplyMarkup({
      reply_markup: clickSoundsKeyboard(ctx.lang, {
        master: next,
        off: Array.isArray(ctx.user.click_sound_off) ? ctx.user.click_sound_off : [],
      }),
    });
  });

  bot.callbackQuery(/^profile:click_sound:btn:(.+)$/, async (ctx) => {
    const key = ctx.match[1] as ClickSoundButtonKey;
    if (!(CLICK_SOUND_BUTTON_KEYS as readonly string[]).includes(key)) {
      await ctx.answerCallbackQuery();
      return;
    }
    const { muted, off } = await toggleClickSoundButton(ctx.user.telegram_id, key);
    ctx.user.click_sound_off = off;
    await ctx.answerCallbackQuery({
      text: ctx.t(muted ? 'click_sounds.toast.muted' : 'click_sounds.toast.unmuted', {
        label: clickSoundLabel(ctx.lang, key),
      }),
    });
    await ctx.editMessageReplyMarkup({
      reply_markup: clickSoundsKeyboard(ctx.lang, {
        master: ctx.user.click_sound !== false,
        off,
      }),
    });
  });

  // ---- Language ----
  bot.callbackQuery('profile:lang', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('🌐 Language / اللغة / Ngôn ngữ', {
      reply_markup: languageKeyboard(),
    });
  });

  bot.callbackQuery(/^lang:(en|ar|vi)$/, async (ctx) => {
    const next = ctx.match[1] as Lang;
    await setUserLanguage(ctx.user.telegram_id, next);
    ctx.user.language = next;
    ctx.lang = next;
    await ctx.answerCallbackQuery();
    await showProfile(ctx);
  });

  // ---- Deposit history ----
  bot.callbackQuery('profile:deposits', async (ctx) => {
    await ctx.answerCallbackQuery();
    const deposits = await listDeposits(ctx.user.telegram_id);
    if (deposits.length === 0) {
      await ctx.editMessageText(ctx.t('profile.deposits.empty'), {
        reply_markup: profileKeyboard(ctx.lang),
      });
      return;
    }
    const lines = [ctx.t('profile.deposits.title'), ''];
    for (const d of deposits) {
      lines.push(
        ctx.t('profile.deposits.line', {
          id: d.id,
          amount: d.amount,
          method: d.method,
          status: d.status,
          date: d.created_at.slice(0, 10),
        }),
      );
    }
    await ctx.editMessageText(lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard(ctx.lang),
    });
  });

  // ---- Clear cache ----
  // Wipes the in-memory data cache AND deletes old menu / navigation
  // messages from the chat to speed it up. Claimed-product (account /
  // link) delivery messages are flagged protected at send-time and are
  // never deleted here.
  bot.callbackQuery('profile:clear_cache', async (ctx) => {
    cache.clearAll();

    let deleted = 0;
    const chatId = ctx.chat?.id;
    const currentMsgId = ctx.callbackQuery?.message?.message_id ?? null;
    if (chatId) {
      // Keep the Settings screen we're rendering on so we can edit it
      // back to the post-clear state instead of vanishing the UI.
      const exclude = new Set<number>();
      if (typeof currentMsgId === 'number') exclude.add(currentMsgId);
      // Look back up to 200 message IDs from the current screen so we
      // catch messages from before the bot was last restarted (the
      // in-memory tracker is empty across restarts). Telegram rejects
      // deletes for messages we didn't send or that are >48h old, so
      // those errors are silently absorbed.
      const ids = buildDeletable(chatId, currentMsgId, 200, exclude);

      // Single-message deletes — robust to mixed ownership / age.
      // Telegram bots are rate-limited to ~30 ops/sec per chat so this
      // typically finishes in a few seconds for the 200-id window.
      for (const id of ids) {
        try {
          await ctx.api.deleteMessage(chatId, id);
          deleted++;
        } catch (err) {
          // 400 "message can't be deleted" / "message to delete not
          // found" are expected for messages we didn't send or that
          // are too old — ignore them.
          const desc = (err as { description?: string }).description ?? '';
          if (
            !desc.includes("can't be deleted") &&
            !desc.includes('to delete not found') &&
            !desc.includes('MESSAGE_ID_INVALID')
          ) {
            logger.debug({ err, id }, 'deleteMessage failed');
          }
        }
      }
    }

    await ctx.answerCallbackQuery({
      text: ctx.t('cache.cleared.user', { count: deleted }),
    });
    await showProfile(ctx);
  });
}
