import { Composer, InlineKeyboard } from 'grammy';
import { env } from '../env.js';
import { backToMenuKeyboard } from '../keyboards/mainMenu.js';
import { btn } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';
import { getAdminContactUrl } from '../services/settings.js';
import { logger } from '../logger.js';
import type { Lang } from '../../config/index.js';

/**
 * Set of users currently waiting for a one-shot AI Support reply.
 *
 * The AI Support flow is single-message: tap the button, type a
 * question, get one answer back, and we drop them from the set so the
 * next message is treated normally.
 */
const aiArmed = new Set<number>();

/**
 * Single-slot Live Support state. Only one user can be in an active
 * relay session at a time — additional users get a "busy" popup and
 * are asked to retry. Kept in-memory because sessions are short and
 * we don't want to persist relay metadata across redeploys.
 */
let liveUser: { telegram_id: number; first_name: string; username: string | null } | null = null;

function liveKeyboardForUser(t: (k: string) => string): InlineKeyboard {
  // User taps Cancel → we delete the panel and re-render the Support
  // section. Admin still gets the standard End Session control.
  return new InlineKeyboard().text(t('support.btn.cancel'), 'support:live:cancel:user');
}

function liveKeyboardForAdmin(t: (k: string) => string): InlineKeyboard {
  return new InlineKeyboard().text(t('support.btn.end_session'), 'support:live:end:admin');
}

function supportKeyboard(
  t: (k: string) => string,
  contactUrl: string,
  lang: Lang,
): InlineKeyboard {
  return new InlineKeyboard()
    .url(t('support.btn.contact'), contactUrl)
    .text(t('support.btn.live'), 'support:live:start')
    .row()
    .text(btn(lang, 'back'), 'main:open');
}

async function endSession(
  ctx: AppCtx,
  endedBy: 'user' | 'admin',
): Promise<void> {
  const target = liveUser;
  liveUser = null;
  if (!target) return;
  // Clear the user's flow so subsequent messages stop being relayed.
  if (endedBy === 'user' && ctx.session?.userFlow?.type === 'live_support') {
    ctx.session.userFlow = undefined;
  }
  // Notify both sides; failures are logged but don't break the flow.
  try {
    await ctx.api.sendMessage(target.telegram_id, renderMdHtml(ctx.t('support.live.user_ended')), {
      parse_mode: 'HTML',
    });
  } catch (err) {
    logger.warn({ err, target: target.telegram_id }, 'live-support: failed to notify user of end');
  }
  try {
    await ctx.api.sendMessage(env.ADMIN_USER_ID, renderMdHtml(ctx.t('support.live.admin_ended')), {
      parse_mode: 'HTML',
    });
  } catch (err) {
    logger.warn({ err }, 'live-support: failed to notify admin of end');
  }
}

export function registerSupport(bot: Composer<AppCtx>): void {
  bot.callbackQuery('support:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    const text = `${ctx.t('support.title')}\n\n${ctx.t('support.body')}`;
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: supportKeyboard((k) => ctx.t(k), getAdminContactUrl(), ctx.lang),
    });
  });

  // ------------------------------ Live Support ----------------------
  bot.callbackQuery('support:live:start', async (ctx) => {
    if (liveUser !== null && liveUser.telegram_id !== ctx.user.telegram_id) {
      await ctx.answerCallbackQuery({
        text: ctx.t('support.live.busy_popup'),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    liveUser = {
      telegram_id: ctx.user.telegram_id,
      first_name: ctx.user.first_name ?? '—',
      username: ctx.user.username ?? null,
    };
    ctx.session.userFlow = {
      type: 'live_support',
      step: 'connected',
      data: { startedAt: Date.now() },
    };
    // Notify admin first so they know who's incoming.
    try {
      const adminMsg = ctx.t('support.live.admin_started', {
        name: liveUser.first_name,
        username: liveUser.username ?? '—',
        id: String(liveUser.telegram_id),
      });
      await ctx.api.sendMessage(env.ADMIN_USER_ID, renderMdHtml(adminMsg), {
        parse_mode: 'HTML',
        reply_markup: liveKeyboardForAdmin((k) => ctx.t(k)),
      });
    } catch (err) {
      logger.error({ err }, 'live-support: failed to notify admin on session start');
    }
    await ctx.editMessageText(renderMdHtml(ctx.t('support.live.user_active')), {
      parse_mode: 'HTML',
      reply_markup: liveKeyboardForUser((k) => ctx.t(k)),
    });
  });

  // User cancels their own Live Support panel — we delete the panel
  // message entirely and post a fresh Support screen so they can
  // start over (or pick Contact Admin instead).
  bot.callbackQuery('support:live:cancel:user', async (ctx) => {
    await ctx.answerCallbackQuery();
    const wasActive = liveUser?.telegram_id === ctx.user.telegram_id;
    if (wasActive) {
      await endSession(ctx, 'user');
    } else {
      ctx.session.userFlow = undefined;
    }
    // Best-effort delete of the Live Support panel message itself.
    try {
      await ctx.deleteMessage();
    } catch (err) {
      logger.warn({ err }, 'live-support: failed to delete cancelled panel');
    }
    // Re-open the Support section as a brand-new chat message.
    const text = `${ctx.t('support.title')}\n\n${ctx.t('support.body')}`;
    await ctx.reply(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: supportKeyboard((k) => ctx.t(k), getAdminContactUrl(), ctx.lang),
    });
  });

  bot.callbackQuery('support:live:end:admin', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.from?.id !== env.ADMIN_USER_ID) return;
    await endSession(ctx, 'admin');
  });

  // /end command — admin shortcut to close the current relay session.
  bot.command('end', async (ctx, next) => {
    if (ctx.from?.id !== env.ADMIN_USER_ID) return next();
    if (liveUser === null) return next();
    await endSession(ctx, 'admin');
  });

  // ------------------------------ Relay handlers --------------------
  // User-side: forward every non-command message to the admin while
  // the user's flow is `live_support`. Runs before the AI Support
  // catch-all so relay text isn't accidentally fed into OpenAI.
  bot.on('message', async (ctx, next) => {
    const flow = ctx.session?.userFlow;
    if (!flow || flow.type !== 'live_support') return next();
    if (ctx.from?.id === env.ADMIN_USER_ID) return next();
    if (liveUser === null || liveUser.telegram_id !== ctx.from?.id) {
      // Session was cleared from the other side — drop the flow and
      // let the message fall through to normal handlers.
      ctx.session.userFlow = undefined;
      return next();
    }
    const text = ctx.message?.text;
    if (typeof text === 'string' && text.startsWith('/')) return next();

    const senderName = liveUser.first_name;
    try {
      if (typeof text === 'string') {
        await ctx.api.sendMessage(
          env.ADMIN_USER_ID,
          renderMdHtml(ctx.t('support.live.admin_relay', { name: senderName, text })),
          { parse_mode: 'HTML' },
        );
      } else {
        // Forward media (photo / video / document / voice) by copying
        // the message verbatim, prefixed with a sender header so the
        // admin sees who it's from.
        await ctx.api.sendMessage(
          env.ADMIN_USER_ID,
          renderMdHtml(ctx.t('support.live.admin_media_header', { name: senderName })),
          { parse_mode: 'HTML' },
        );
        await ctx.api.copyMessage(
          env.ADMIN_USER_ID,
          ctx.chat!.id,
          ctx.message!.message_id,
        );
      }
    } catch (err) {
      logger.error({ err }, 'live-support: failed to relay user→admin');
    }
  });

  // Admin-side: forward admin's plain messages to the connected user.
  // Skips slash-commands and any message dispatched while an admin
  // input flow is active so we don't hijack /find, /announce, etc.
  bot.on('message', async (ctx, next) => {
    if (ctx.from?.id !== env.ADMIN_USER_ID) return next();
    if (liveUser === null) return next();
    if (ctx.session?.adminFlow) return next();
    const text = ctx.message?.text;
    if (typeof text === 'string' && text.startsWith('/')) return next();

    // No `[Admin]` tag on the user-facing side — the relay forwards
    // the admin's text and media verbatim so it reads like a normal
    // chat message rather than a tagged forward.
    try {
      await ctx.api.copyMessage(
        liveUser.telegram_id,
        ctx.chat!.id,
        ctx.message!.message_id,
      );
    } catch (err) {
      logger.error({ err }, 'live-support: failed to relay admin→user');
    }
  });

  // ------------------------------ AI Support ------------------------
  bot.callbackQuery('support:ai', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      renderMdHtml(`${ctx.t('support.ai.title')}\n\n${ctx.t('support.ai.prompt')}`),
      { parse_mode: 'HTML', reply_markup: backToMenuKeyboard(ctx.lang) },
    );
    if (ctx.from) aiArmed.add(ctx.from.id);
  });

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from || !aiArmed.has(ctx.from.id)) return next();
    aiArmed.delete(ctx.from.id);
    const answer = await answerAI(ctx.message.text);
    await ctx.reply(answer, { reply_markup: backToMenuKeyboard(ctx.lang) });
  });
}

async function answerAI(question: string): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    return `🤖 (stub) I received: "${question.slice(0, 200)}"\n\nA human will follow up shortly.`;
  }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              "You are SafwanTiger Shop's helpful customer support assistant. Be concise.",
          },
          { role: 'user', content: question },
        ],
        temperature: 0.3,
      }),
    });
    if (!res.ok) return `🤖 ${await res.text()}`;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content ?? '🤖 (no answer)';
  } catch (err) {
    return `🤖 ${(err as Error).message}`;
  }
}
