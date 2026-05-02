import { Composer, InlineKeyboard } from 'grammy';
import { env } from '../env.js';
import { backToMenuKeyboard } from '../keyboards/mainMenu.js';
import { inlineBtn } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';
import { getAdminContactUrlWithPrefill } from '../services/settings.js';
import { logger } from '../logger.js';
import type { Lang } from '../../config/index.js';
import { deleteSetting, readSetting, setSetting } from '../db/queries.js';

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
 * are asked to retry.
 *
 * Persisted to the `settings` table under key `live_support.session`
 * so the relay survives bot restarts. Render redeploys (one per merge)
 * would otherwise wipe this in-memory slot, leaving the user's panel +
 * topics in place but the bot unaware that a session is active —
 * which is exactly the bug that caused admin-not-receiving-messages.
 */
type LiveUser = {
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
};

let liveUser: LiveUser | null = null;

const LIVE_SUPPORT_KEY = 'live_support.session';

/**
 * Persist the current `liveUser` slot to the `settings` table so the
 * next bot lifecycle can pick the session back up. Best-effort — a
 * failed write only affects relay survival across the next restart,
 * never the current session.
 */
async function persistLiveUser(): Promise<void> {
  try {
    if (liveUser === null) {
      await deleteSetting(LIVE_SUPPORT_KEY);
      return;
    }
    await setSetting(LIVE_SUPPORT_KEY, {
      telegram_id: liveUser.telegram_id,
      first_name: liveUser.first_name,
      username: liveUser.username,
      user_topic_id: liveUser.userTopicId ?? null,
      admin_topic_id: liveUser.adminTopicId ?? null,
      panel_message_id: liveUser.panelMessageId ?? null,
    });
  } catch (err) {
    logger.warn({ err }, 'live-support: failed to persist session');
  }
}

/**
 * Restore the persisted Live Support slot into memory. Called once at
 * bot startup from `bot.ts`. Without this, every Render redeploy
 * would silently break any in-progress session because the relay
 * handlers would see `liveUser === null`.
 */
export async function restoreLiveSupportSession(): Promise<void> {
  try {
    const raw = await readSetting(LIVE_SUPPORT_KEY);
    if (!raw || typeof raw !== 'object') return;
    const obj = raw as Record<string, unknown>;
    const telegramId = Number(obj.telegram_id);
    if (!Number.isFinite(telegramId) || telegramId <= 0) return;
    liveUser = {
      telegram_id: telegramId,
      first_name: typeof obj.first_name === 'string' ? obj.first_name : '—',
      username: typeof obj.username === 'string' ? obj.username : null,
      userTopicId:
        obj.user_topic_id != null ? Number(obj.user_topic_id) : undefined,
      adminTopicId:
        obj.admin_topic_id != null ? Number(obj.admin_topic_id) : undefined,
      panelMessageId:
        obj.panel_message_id != null ? Number(obj.panel_message_id) : undefined,
    };
    logger.info(
      {
        telegramId,
        userTopicId: liveUser.userTopicId,
        adminTopicId: liveUser.adminTopicId,
      },
      'live-support: restored persisted session from DB',
    );
  } catch (err) {
    logger.warn({ err }, 'live-support: failed to restore persisted session');
  }
}

const TOPIC_NAME_USER = 'Live Support';
/** Light-blue topic icon (Telegram's default for new topics). */
const TOPIC_ICON_COLOR = 0x6fb9f0;

function liveKeyboardForUser(t: (k: string) => string): InlineKeyboard {
  // User taps Cancel → we delete the topic + pinned panel and
  // re-render the Support section. Admin still gets the standard End
  // Session control.
  return new InlineKeyboard()
    .text(t('support.btn.cancel'), 'support:live:cancel:user')
    .danger();
}

function liveKeyboardForAdmin(t: (k: string) => string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('support.btn.end_session'), 'support:live:end:admin')
    .danger();
}

function supportKeyboard(
  t: (k: string) => string,
  contactUrl: string,
  lang: Lang,
): InlineKeyboard {
  // Stack each action on its own full-width row, matching the look
  // of the Notifications submenu.
  const kb = new InlineKeyboard();
  kb.url(t('support.btn.contact'), contactUrl).primary();
  kb.row();
  kb.text(t('support.btn.live'), 'support:live:start').success();
  kb.row();
  inlineBtn(kb, lang, 'back', 'main:open');
  return kb;
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

/**
 * Best-effort delete of a forum topic + every message inside it.
 *
 * Retried once on failure: when the API returns a transient error
 * (rate limit, briefly-unavailable chat) the second call usually
 * succeeds. If the second call also fails we log at `error` level so
 * the orphaned topic is visible in production logs and we can chase
 * it down manually instead of leaving a stale thread on the user's
 * side after Cancel.
 */
async function tryDeleteTopic(
  ctx: AppCtx,
  chatId: number,
  threadId: number | undefined,
): Promise<void> {
  if (!threadId) return;
  try {
    await ctx.api.deleteForumTopic(chatId, threadId);
    return;
  } catch (err) {
    logger.warn(
      { err, chatId, threadId },
      'live-support: deleteForumTopic failed, retrying once',
    );
  }
  try {
    await ctx.api.deleteForumTopic(chatId, threadId);
  } catch (err) {
    logger.error(
      { err, chatId, threadId },
      'live-support: deleteForumTopic failed after retry — topic may persist as orphan',
    );
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
  await persistLiveUser();
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
    // Same user re-clicking Live Support while their own session is
    // still active: don't tear down + recreate (which would orphan
    // the previous topics and panel). Tear down the old session
    // first, then fall through to create a fresh one. This handles
    // the case where the user's panel got lost in scrollback or the
    // previous cancel left some Telegram state behind.
    if (liveUser !== null && liveUser.telegram_id === ctx.user.telegram_id) {
      logger.info(
        { telegram_id: liveUser.telegram_id },
        'live-support: re-start by same user, tearing down previous topics first',
      );
      const prev = liveUser;
      liveUser = null;
      await persistLiveUser();
      await tryDeleteTopic(ctx, prev.telegram_id, prev.userTopicId);
      await tryDeleteTopic(ctx, env.ADMIN_USER_ID, prev.adminTopicId);
      await teardownPanel(ctx, prev.telegram_id, prev.panelMessageId);
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

    // Persist the fully-populated session row so the next bot
    // lifecycle (Render redeploy, OOM restart, etc.) can pick the
    // relay back up without the user having to cancel + re-open.
    await persistLiveUser();

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
    // The relay state (`liveUser`) is the source of truth, NOT
    // `ctx.session.userFlow`. The session is in-memory and is wiped
    // on every Render redeploy, so we'd otherwise miss every message
    // the user typed after a redeploy until they cancel + re-open
    // Live Support. `liveUser` is rehydrated from the `settings` table
    // on bot startup (see `restoreLiveSupportSession`), so checking
    // it directly survives restarts.
    if (ctx.from?.id === env.ADMIN_USER_ID) return next();
    if (liveUser === null || liveUser.telegram_id !== ctx.from?.id) {
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

    // We used to mirror General-tab messages into the Live Support
    // topic via `copyMessage(chat.id → chat.id, ..., message_thread_id)`
    // so the topic page showed the full conversation no matter which
    // tab the user typed in. That mirror is gone now: `copyMessage`
    // produces a NEW message authored by the bot, which Telegram
    // renders on the LEFT (incoming) side in the All view. The user
    // already sees their own message on the RIGHT in General, so the
    // mirror duplicated every outgoing message in the All feed and
    // also made the Live Support topic look one-sided (every message
    // appeared as a bot/incoming message instead of as the user's).
    // For the cleanest UX users should type inside the Live Support
    // tab — the panel copy already says exactly that.

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
