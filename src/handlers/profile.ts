import type { Composer } from 'grammy';
import { type Lang } from '../../config/index.js';
import {
  countReferrals,
  listDeposits,
  listOrders,
  setUserLanguage,
  toggleNotification,
} from '../db/queries.js';
import * as cache from '../services/cache.js';
import { takeDeletable } from '../services/messageTracker.js';
import {
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
    const currentMsgId = ctx.callbackQuery?.message?.message_id;
    if (chatId) {
      // Keep the Settings screen we're rendering on so we can edit it
      // back to the post-clear state instead of vanishing the UI.
      const exclude = new Set<number>();
      if (typeof currentMsgId === 'number') exclude.add(currentMsgId);
      const ids = takeDeletable(chatId, exclude);

      // Bulk-delete in chunks of 100 (Telegram API limit). Fall back to
      // single-message deletes if the bulk call fails (e.g. messages
      // older than 48h).
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        try {
          await ctx.api.deleteMessages(chatId, chunk);
          deleted += chunk.length;
        } catch (err) {
          logger.debug({ err }, 'deleteMessages bulk failed; retrying per-message');
          for (const id of chunk) {
            try {
              await ctx.api.deleteMessage(chatId, id);
              deleted++;
            } catch {
              /* message may already be gone or too old; ignore */
            }
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
