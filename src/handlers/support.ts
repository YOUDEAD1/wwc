import { Composer, InlineKeyboard } from 'grammy';
import { env } from '../env.js';
import { backToMenuKeyboard } from '../keyboards/mainMenu.js';
import { btn } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';
import { getAdminContactUrlWithPrefill } from '../services/settings.js';
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
let liveUser: {
  telegram_id: number;
  first_name: string;
  username: string | null;
  /**
   * Forum-topic thread id created in the user's chat. Set when the
   * bot has forum topics enabled in @BotFather (Bot API ≥ 9.4) — the
   * user then sees a dedicated "Live Support" tab at the top of the
   * chat. Falls back to `undefined` if topic creation isn't allowed,
   * in which case we keep the legacy pinned-panel-only flow.
   */
  userTopicId?: number;
  /**
   * Mirrored forum-topic thread id in the admin's chat with the bot,
   * named "Live Support — <user>". Lets the admin keep each support
   * session isolated in its own tab instead of mixed into one stream.
   */
  adminTopicId?: number;
  /**
   * Id of the pinned "Live Support" panel message in the user's
   * General chat. Tracked here (rather than only in the user's
   * session) so admin-side teardown can also clean it up.
   */
  panelMessageId?: number;
} | null = null;

const TOPIC_NAME_USER = 'Live Support';
/** Light-blue topic icon (Telegram's default for new topics). */
const TOPIC_ICON_COLOR = 0x6fb9f0;

function liveKeyboardForUser(t: (k: string) => string): InlineKeyboard {
  // User taps Cancel → we delete the topic + pinned panel and
  // re-render the Support section. Admin still gets the standard End
  // Session control.
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
  // Stack each action on its own full-width row, matching the look
  // of the Notifications submenu.
  return new InlineKeyboard()
    .url(t('support.btn.contact'), contactUrl)
    .row()
    .text(t('support.btn.live'), 'support:live:start')
    .row()
    .text(btn(lang, 'back'), 'main:open');
}

/**
 * Best-effort wrapper around `createForumTopic` for a private bot
 * chat. Requires the bot owner to have enabled forum topics in
 * @BotFather (Bot Settings → Configure Mini App → Topics). When the
 * call fails (older bot, owner hasn't enabled it, etc.) we fall back
 * to the legacy pinned-panel-only relay so Live Support keeps
 * working.
 */
async function tryCreateTopic(
  ctx: AppCtx,
  chatId: number,
  name: string,
): Promise<number | undefined> {
  try {
    const topic = await ctx.api.createForumTopic(chatId, name, {
      icon_color: TOPIC_ICON_COLOR,
    });
    return topic.message_thread_id;
  } catch (err) {
    logger.warn(
      { err, chatId, name },
      'live-support: createForumTopic failed (falling back to pinned-panel relay)',
    );
    return undefined;
  }
}

/** Best-effort delete of a forum topic + every message inside it. */
async function tryDeleteTopic(
  ctx: AppCtx,
  chatId: number,
  threadId: number | undefined,
): Promise<void> {
  if (!threadId) return;
  try {
    await ctx.api.deleteForumTopic(chatId, threadId);
  } catch (err) {
    logger.warn({ err, chatId, threadId }, 'live-support: deleteForumTopic failed');
  }
}

/**
 * Best-effort unpin + delete of the pinned Live Support panel message
 * for the given user. Used both when the user cancels themselves and
 * when the admin closes the session from their side.
 */
async function teardownPanel(
  ctx: AppCtx,
  userTelegramId: number,
  panelMessageId: number | undefined,
): Promise<void> {
  if (!panelMessageId) return;
  try {
    await ctx.api.unpinChatMessage(userTelegramId, panelMessageId);
  } catch (err) {
    logger.warn({ err }, 'live-support: failed to unpin panel');
  }
  try {
    await ctx.api.deleteMessage(userTelegramId, panelMessageId);
  } catch (err) {
    logger.warn({ err }, 'live-support: failed to delete panel');
  }
}

async function endSession(
  ctx: AppCtx,
  endedBy: 'user' | 'admin',
): Promise<void> {
  const target = liveUser;
  liveUser = null;
  if (!target) return;
  // Clear the user's session flow so subsequent messages stop being
  // relayed (only reachable when the user themselves ended).
  if (endedBy === 'user' && ctx.session?.userFlow?.type === 'live_support') {
    ctx.session.userFlow = undefined;
  }
  // Tear down the forum topics first — deleting a topic removes every
  // message inside it, which is exactly the "all del when the user
  // cancel the support" behavior we want on both sides.
  await tryDeleteTopic(ctx, target.telegram_id, target.userTopicId);
  await tryDeleteTopic(ctx, env.ADMIN_USER_ID, target.adminTopicId);
  // Tear down the pinned Live Support panel on the user's side. The
  // panel id is on the in-memory slot so this works for both
  // user-initiated cancels and admin-initiated ends.
  await teardownPanel(ctx, target.telegram_id, target.panelMessageId);
  // Notify both sides via their main (General) chats; failures are
  // logged but don't break the flow.
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
  // ------------------------------ Stray topic auto-delete ----------
  // Telegram spawns a new forum topic named after every plain
  // message a user types in their main "New Chat" tab when topics
  // are enabled — so without this guard a user typing "hi" in the
  // bot's chat would clutter the tab bar with a stray "hi" thread.
  //
  // CRITICAL: skip topics whose name matches one of the bot-created
  // Live Support topics. In private chats the `from` field on the
  // forum_topic_created service message is the chat owner (the user),
  // NOT the bot — so we cannot rely on `from.id === ctx.me.id` to
  // tell our own topics apart from user-typed ones. Earlier versions
  // did exactly that, which silently deleted every Live Support topic
  // the bot created and broke the relay + the All / Live Support tab.
  bot.on('message:forum_topic_created', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    const topicName = ctx.message?.forum_topic_created?.name;
    if (
      topicName === TOPIC_NAME_USER ||
      (topicName !== undefined && topicName.startsWith(`${TOPIC_NAME_USER} — `))
    ) {
      // This is the bot's own Live Support topic on either the
      // user's or admin's side. Leave it alone.
      return next();
    }
    const threadId = ctx.message?.message_thread_id;
    if (!threadId) return next();
    try {
      await ctx.api.deleteForumTopic(ctx.chat.id, threadId);
    } catch (err) {
      logger.warn(
        { err, threadId, chatId: ctx.chat.id },
        'live-support: failed to auto-delete stray user-created topic',
      );
    }
  });

  bot.callbackQuery('support:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    const text = `${ctx.t('support.title')}\n\n${ctx.t('support.body')}`;
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: supportKeyboard(
        (k) => ctx.t(k),
        getAdminContactUrlWithPrefill(ctx.t('support.contact_prefill')),
        ctx.lang,
      ),
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

    // Create a "Live Support" forum topic in the user's chat so they
    // get the dedicated tab at the top of the chat (matching the
    // photo). Mirrors a per-session topic in the admin's chat too so
    // each session lives in its own thread on both sides.
    const userTopicId = await tryCreateTopic(
      ctx,
      ctx.user.telegram_id,
      TOPIC_NAME_USER,
    );
    if (liveUser) liveUser.userTopicId = userTopicId;

    const adminTopicLabel = `${TOPIC_NAME_USER} — ${liveUser.first_name}`;
    const adminTopicId = await tryCreateTopic(
      ctx,
      env.ADMIN_USER_ID,
      adminTopicLabel,
    );
    if (liveUser) liveUser.adminTopicId = adminTopicId;

    logger.info(
      {
        userTelegramId: ctx.user.telegram_id,
        userTopicId,
        adminTopicId,
      },
      'live-support: session start (topic ids — undefined means createForumTopic failed)',
    );

    // Delete the original Support screen so only the Live Support
    // panel remains in chat (per user request: "the support msg auto
    // del and the just live supports msgs").
    try {
      await ctx.deleteMessage();
    } catch (err) {
      logger.warn({ err }, 'live-support: failed to delete support menu');
    }

    // Send the user-facing panel. When forum topics are available we
    // put the panel INSIDE the user's Live Support topic (and pin it
    // there) so the topic page shows the Cancel button + status line
    // and General chat stays clean. When topic creation fails we fall
    // back to a pinned panel in General so the relay still has a
    // visible Cancel affordance.
    let panelMessageId: number | undefined;
    const panelInTopic = userTopicId !== undefined;
    try {
      const panel = await ctx.api.sendMessage(
        ctx.user.telegram_id,
        renderMdHtml(ctx.t('support.live.user_active')),
        {
          parse_mode: 'HTML',
          ...(userTopicId ? { message_thread_id: userTopicId } : {}),
          reply_markup: liveKeyboardForUser((k) => ctx.t(k)),
        },
      );
      panelMessageId = panel.message_id;
      try {
        await ctx.api.pinChatMessage(ctx.user.telegram_id, panelMessageId, {
          disable_notification: true,
        });
      } catch (err) {
        logger.warn({ err }, 'live-support: failed to pin panel');
      }
    } catch (err) {
      logger.error({ err }, 'live-support: failed to send panel message');
    }
    if (liveUser) liveUser.panelMessageId = panelInTopic ? undefined : panelMessageId;

    // Notify the admin and seed their topic. When `adminTopicId` is
    // undefined (forum topics not available on the admin's side) the
    // message lands in the admin's main chat as before.
    try {
      const adminMsg = ctx.t('support.live.admin_started', {
        name: liveUser.first_name,
        username: liveUser.username ?? '—',
        id: String(liveUser.telegram_id),
      });
      await ctx.api.sendMessage(env.ADMIN_USER_ID, renderMdHtml(adminMsg), {
        parse_mode: 'HTML',
        ...(adminTopicId ? { message_thread_id: adminTopicId } : {}),
        reply_markup: liveKeyboardForAdmin((k) => ctx.t(k)),
      });
    } catch (err) {
      logger.error({ err }, 'live-support: failed to notify admin on session start');
    }

    // Track the panel + topic ids on the user's session so cancel +
    // stale-tap handlers can clean everything up. When the panel is
    // pinned inside a topic, deleting the topic on cancel removes the
    // panel automatically, so we only track `panelMessageId` for the
    // General-fallback case.
    ctx.session.userFlow = {
      type: 'live_support',
      step: 'connected',
      data: {
        startedAt: Date.now(),
        panelMessageId: panelInTopic ? undefined : panelMessageId,
        userTopicId,
        adminTopicId,
      },
    };
  });

  // User cancels their own Live Support panel. `endSession` handles
  // deleting the topics + unpinning the panel and posting the closure
  // message, so we just delegate to it.
  bot.callbackQuery('support:live:cancel:user', async (ctx) => {
    await ctx.answerCallbackQuery();
    const wasActive = liveUser?.telegram_id === ctx.user.telegram_id;
    if (wasActive) {
      await endSession(ctx, 'user');
      return;
    }
    // Stale Cancel tap (session already torn down). Best-effort
    // cleanup using whatever ids we still have on the session, then
    // clear the flow so the chat doesn't get stuck.
    const flow = ctx.session?.userFlow;
    if (flow?.type === 'live_support') {
      const { panelMessageId, userTopicId, adminTopicId } = flow.data;
      ctx.session.userFlow = undefined;
      if (ctx.chat) {
        await tryDeleteTopic(ctx, ctx.chat.id, userTopicId);
        await teardownPanel(ctx, ctx.chat.id, panelMessageId);
      }
      await tryDeleteTopic(ctx, env.ADMIN_USER_ID, adminTopicId);
    } else {
      ctx.session.userFlow = undefined;
    }
    try {
      await ctx.deleteMessage();
    } catch (err) {
      logger.warn({ err }, 'live-support: failed to delete stale cancel button');
    }
    await ctx.reply(renderMdHtml(ctx.t('support.live.user_ended')), {
      parse_mode: 'HTML',
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
  // the user's flow is `live_support`. We relay messages from any
  // tab (General + Live Support topic) so the admin never misses
  // anything during a session, AND we mirror General-chat messages
  // into the user's Live Support topic so the topic page shows the
  // full conversation. Runs before the AI Support catch-all so relay
  // text isn't accidentally fed into OpenAI.
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
    // Forum service messages (topic created/edited/closed/reopened)
    // can't be relayed — copyMessage refuses them and they'd carry
    // no user content anyway.
    if (
      ctx.message?.forum_topic_created ||
      ctx.message?.forum_topic_edited ||
      ctx.message?.forum_topic_closed ||
      ctx.message?.forum_topic_reopened
    ) {
      return next();
    }
    const text = ctx.message?.text;
    if (typeof text === 'string' && text.startsWith('/')) return next();

    // Relay every user message regardless of which topic they typed
    // it in: if the user is on the General tab and types there, we
    // still want admin to see it AND the message to land in the Live
    // Support topic ("All chats in any thread while the support need
    // to auto come in support thread page" — user feedback).
    const messageThreadId = ctx.message?.message_thread_id;
    if (
      liveUser.userTopicId &&
      messageThreadId !== liveUser.userTopicId &&
      ctx.chat
    ) {
      try {
        await ctx.api.copyMessage(
          ctx.chat.id,
          ctx.chat.id,
          ctx.message!.message_id,
          { message_thread_id: liveUser.userTopicId },
        );
      } catch (err) {
        logger.warn(
          { err },
          'live-support: failed to mirror user message into Live Support topic',
        );
      }
    }

    const senderName = liveUser.first_name;
    // When the admin-side topic exists we deliver into it. If the
    // sendMessage with `message_thread_id` fails (e.g. the topic got
    // deleted out from under us), retry without the thread id so the
    // admin still gets the message in their main chat — better than
    // silently dropping it.
    const tryRelay = async (
      payload: () => Promise<unknown>,
      payloadFallback: () => Promise<unknown>,
    ) => {
      try {
        await payload();
      } catch (err) {
        logger.warn(
          { err },
          'live-support: relay to admin topic failed, retrying in admin General',
        );
        try {
          await payloadFallback();
        } catch (err2) {
          logger.error({ err: err2 }, 'live-support: relay to admin General also failed');
        }
      }
    };

    if (typeof text === 'string') {
      const html = renderMdHtml(ctx.t('support.live.admin_relay', { name: senderName, text }));
      await tryRelay(
        () =>
          ctx.api.sendMessage(env.ADMIN_USER_ID, html, {
            parse_mode: 'HTML',
            ...(liveUser?.adminTopicId
              ? { message_thread_id: liveUser.adminTopicId }
              : {}),
          }),
        () =>
          ctx.api.sendMessage(env.ADMIN_USER_ID, html, {
            parse_mode: 'HTML',
          }),
      );
    } else {
      const headerHtml = renderMdHtml(
        ctx.t('support.live.admin_media_header', { name: senderName }),
      );
      const adminTopicOpt = liveUser?.adminTopicId
        ? { message_thread_id: liveUser.adminTopicId }
        : {};
      await tryRelay(
        async () => {
          await ctx.api.sendMessage(env.ADMIN_USER_ID, headerHtml, {
            parse_mode: 'HTML',
            ...adminTopicOpt,
          });
          await ctx.api.copyMessage(
            env.ADMIN_USER_ID,
            ctx.chat!.id,
            ctx.message!.message_id,
            adminTopicOpt,
          );
        },
        async () => {
          await ctx.api.sendMessage(env.ADMIN_USER_ID, headerHtml, {
            parse_mode: 'HTML',
          });
          await ctx.api.copyMessage(
            env.ADMIN_USER_ID,
            ctx.chat!.id,
            ctx.message!.message_id,
          );
        },
      );
    }
  });

  // Admin-side: forward admin's plain messages to the connected user.
  // Skips slash-commands and any message dispatched while an admin
  // input flow is active so we don't hijack /find, /announce, etc.
  // When an admin-side topic exists we only relay messages from
  // inside it — admin's General chat keeps behaving normally.
  bot.on('message', async (ctx, next) => {
    if (ctx.from?.id !== env.ADMIN_USER_ID) return next();
    if (liveUser === null) return next();
    if (ctx.session?.adminFlow) return next();
    if (
      ctx.message?.forum_topic_created ||
      ctx.message?.forum_topic_edited ||
      ctx.message?.forum_topic_closed ||
      ctx.message?.forum_topic_reopened
    ) {
      return next();
    }
    const text = ctx.message?.text;
    if (typeof text === 'string' && text.startsWith('/')) return next();

    const messageThreadId = ctx.message?.message_thread_id;
    if (liveUser.adminTopicId && messageThreadId !== liveUser.adminTopicId) {
      return next();
    }

    // No `[Admin]` tag on the user-facing side — the relay forwards
    // the admin's text and media verbatim so it reads like a normal
    // chat message rather than a tagged forward.
    const userThreadOpt = liveUser.userTopicId
      ? { message_thread_id: liveUser.userTopicId }
      : {};
    try {
      await ctx.api.copyMessage(
        liveUser.telegram_id,
        ctx.chat!.id,
        ctx.message!.message_id,
        userThreadOpt,
      );
    } catch (err) {
      logger.warn(
        { err },
        'live-support: relay to user topic failed, retrying in user General',
      );
      try {
        await ctx.api.copyMessage(
          liveUser.telegram_id,
          ctx.chat!.id,
          ctx.message!.message_id,
        );
      } catch (err2) {
        logger.error({ err: err2 }, 'live-support: relay to user General also failed');
      }
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
