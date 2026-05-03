import { Composer, InlineKeyboard, InputFile } from 'grammy';
import { env } from '../env.js';
import { backToMenuKeyboard } from '../keyboards/mainMenu.js';
import { inlineBtn, inlineUrl } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';
import { getAdminContactUrlWithPrefill, getTextOverride } from '../services/settings.js';
import { logger } from '../logger.js';
import type { Lang } from '../../config/index.js';
import { deleteSetting, readSetting, setSetting, findUserById } from '../db/queries.js';
import * as adminLog from '../services/adminLog.js';
import { buildSupportTranscriptPdf } from '../services/pdfReport.js';
import { sendReportEmail } from '../services/mailer.js';

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

/**
 * In-memory chat transcript for the active Live Support session.
 * Reset whenever a new session opens. Each entry captures who sent
 * the message, the timestamp, and a short text representation —
 * media is logged with a `[<kind>]` placeholder so the transcript
 * still reads naturally without trying to embed bytes.
 *
 * Best-effort: if the bot is restarted mid-session the transcript
 * resets (the `liveUser` slot survives DB-side, but the message log
 * does not). The PDF is sent on `endSession` and discarded after.
 */
type TranscriptEntry = {
  at: Date;
  side: 'user' | 'admin';
  authorName: string;
  /** Plain text or `[<kind>]` placeholder. */
  text: string;
};
let transcript: TranscriptEntry[] = [];
let sessionStartedAt: Date | null = null;

function pushTranscript(entry: TranscriptEntry): void {
  // Cap so a runaway / huge conversation doesn't OOM the bot.
  if (transcript.length >= 5000) return;
  transcript.push(entry);
}

/**
 * Per-user cache of the latest Live Support PDF, keyed by Telegram
 * user id. Populated when a session ends so the user can request an
 * emailed copy via the inline button posted under the closure
 * message. Buffers expire after `TRANSCRIPT_CACHE_TTL_MS` so we
 * don't keep large PDFs in memory indefinitely.
 */
type CachedTranscript = {
  buffer: Buffer;
  filename: string;
  expiresAt: number;
  durationSeconds: number;
  messageCount: number;
};
const transcriptCache = new Map<number, CachedTranscript>();
const TRANSCRIPT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cacheTranscript(userId: number, entry: Omit<CachedTranscript, 'expiresAt'>): void {
  transcriptCache.set(userId, {
    ...entry,
    expiresAt: Date.now() + TRANSCRIPT_CACHE_TTL_MS,
  });
}

function readCachedTranscript(userId: number): CachedTranscript | null {
  const hit = transcriptCache.get(userId);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    transcriptCache.delete(userId);
    return null;
  }
  return hit;
}

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

function liveKeyboardForUser(lang: Lang): InlineKeyboard {
  // User taps Cancel → we delete the topic + pinned panel and
  // re-render the Support section. Admin still gets the standard End
  // Session control.
  return inlineBtn(new InlineKeyboard(), lang, 'support_cancel', 'support:live:cancel:user');
}

function liveKeyboardForAdmin(lang: Lang): InlineKeyboard {
  return inlineBtn(
    new InlineKeyboard(),
    lang,
    'support_end_session',
    'support:live:end:admin',
  );
}

function supportKeyboard(
  contactUrl: string,
  lang: Lang,
): InlineKeyboard {
  // Stack each action on its own full-width row, matching the look
  // of the Notifications submenu.
  const kb = new InlineKeyboard();
  inlineUrl(kb, lang, 'support_contact', contactUrl);
  kb.row();
  inlineBtn(kb, lang, 'support_live', 'support:live:start');
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

/**
 * Inline keyboard rendered under the user-facing "Live Support
 * closed" message. The single button arms an email-the-PDF flow
 * that pulls the cached transcript built during `endSession`.
 */
function userClosureKeyboard(lang: Lang): InlineKeyboard {
  return inlineBtn(
    new InlineKeyboard(),
    lang,
    'support_email_transcript',
    'support:transcript:email',
  );
}

async function endSession(
  ctx: AppCtx,
  endedBy: 'user' | 'admin',
): Promise<void> {
  const target = liveUser;
  const startedAt = sessionStartedAt ?? new Date();
  const messagesSnapshot = transcript.slice();
  liveUser = null;
  transcript = [];
  sessionStartedAt = null;
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

  const endedAt = new Date();
  const durationSec = Math.max(
    0,
    Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
  );

  // Build the chat-style PDF transcript first so the user-facing
  // closure message can include the "Send chat PDF to email" button
  // only when we actually have a buffer to email.
  let pdfBuffer: Buffer | null = null;
  let pdfFilename = '';
  try {
    pdfBuffer = await buildSupportTranscriptPdf({
      sessionStartedAt: startedAt,
      sessionEndedAt: endedAt,
      user: {
        telegram_id: target.telegram_id,
        first_name: target.first_name,
        username: target.username,
      },
      endedBy,
      entries: messagesSnapshot.map((e) => ({
        at: e.at,
        side: e.side,
        author: e.authorName,
        text: e.text,
      })),
    });
    const safeName = (target.username ?? `user_${target.telegram_id}`).replace(
      /[^A-Za-z0-9_-]/g,
      '_',
    );
    pdfFilename = `live_support_${safeName}_${startedAt
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-')}.pdf`;
    cacheTranscript(target.telegram_id, {
      buffer: pdfBuffer,
      filename: pdfFilename,
      durationSeconds: durationSec,
      messageCount: messagesSnapshot.length,
    });
  } catch (err) {
    logger.warn({ err }, 'live-support: failed to build transcript PDF');
  }

  // Notify both sides via their main (General) chats; failures are
  // logged but don't break the flow. The user gets an inline
  // "Send chat PDF to email" button below the closure message when
  // the PDF was built successfully.
  //
  // Resolve the user's UI language so the email-transcript button
  // label is rendered in their locale. Falls back to the lang of
  // whoever triggered endSession (admin-side `/end` defaults to the
  // admin's lang) when the DB lookup fails.
  let userLang: Lang = ctx.lang;
  try {
    const userRow = await findUserById(target.telegram_id);
    if (userRow?.language) userLang = userRow.language;
  } catch (err) {
    logger.warn({ err, target: target.telegram_id }, 'live-support: failed to load user lang for closure msg');
  }
  try {
    await ctx.api.sendMessage(target.telegram_id, renderMdHtml(ctx.t('support.live.user_ended')), {
      parse_mode: 'HTML',
      reply_markup: pdfBuffer ? userClosureKeyboard(userLang) : undefined,
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

  // Deep-detail end log + PDF transcript. Best-effort — failures
  // logged but don't break the user-facing flow.
  void adminLog.logSupportEnd(ctx.api, {
    user: {
      telegram_id: target.telegram_id,
      username: target.username,
      first_name: target.first_name,
      email: null,
    },
    endedBy,
    durationSeconds: durationSec,
    messageCount: messagesSnapshot.length,
  });

  if (pdfBuffer) {
    try {
      await adminLog.logSupportTranscript(ctx.api, {
        user: {
          telegram_id: target.telegram_id,
          username: target.username,
          first_name: target.first_name,
          email: null,
        },
        durationSeconds: durationSec,
        messageCount: messagesSnapshot.length,
        pdf: new InputFile(pdfBuffer, pdfFilename),
      });
    } catch (err) {
      logger.warn({ err }, 'live-support: failed to send transcript PDF to log channel');
    }
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
    // Reset the per-session transcript & start clock so the
    // end-of-session PDF only contains messages from THIS session.
    transcript = [];
    sessionStartedAt = new Date();

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
          reply_markup: liveKeyboardForUser(ctx.lang),
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

    // Deep-detail admin log so the support session start lands in the
    // same auditable feed as orders / topups / etc.
    void adminLog.logSupportStart(ctx.api, {
      user: {
        telegram_id: ctx.user.telegram_id,
        username: ctx.user.username ?? null,
        first_name: ctx.user.first_name ?? null,
        email: ctx.user.email ?? null,
      },
      userTopicId,
      adminTopicId,
    });

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
        reply_markup: liveKeyboardForAdmin(ctx.lang),
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

  // Email-the-transcript button posted under the user-facing "Live
  // Support closed" message. Looks up the cached PDF buffer
  // produced when the session ended, mails it via the same Resend
  // / SMTP pipeline My Orders / My Deposits / My Stats use, and
  // confirms with an auto-deleting "Pdf has been sended to mail"
  // chat message (rendered with premium emojis when the user has a
  // Telegram Premium subscription).
  bot.callbackQuery('support:transcript:email', async (ctx) => {
    const email = ctx.user.email;
    if (!email) {
      await ctx.answerCallbackQuery({
        text: ctx.t('support.transcript.no_email_popup'),
        show_alert: true,
      });
      return;
    }
    const cached = readCachedTranscript(ctx.user.telegram_id);
    if (!cached) {
      await ctx.answerCallbackQuery({
        text: ctx.t('support.transcript.expired_popup'),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery({
      text: ctx.t('support.transcript.sending_popup', { email }),
      show_alert: false,
    });
    try {
      const ok = await sendReportEmail({
        email,
        kind: 'support',
        pdf: cached.buffer,
        firstName: ctx.user.first_name ?? null,
        username: ctx.user.username ?? null,
      });
      if (!ok) {
        await ctx.answerCallbackQuery({
          text: ctx.t('support.transcript.failed_popup', { email }),
          show_alert: true,
        });
        return;
      }
      void adminLog.logPdfSent(ctx.api, {
        user: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email,
        },
        kind: 'support',
        destinationEmail: email,
        rowCount: cached.messageCount,
      });
      // Auto-delete the confirmation 5 s later so the chat doesn't
      // accumulate "Pdf sent" lines on repeated taps. Mirrors the
      // exact pattern used by My Orders / My Deposits / My Stats.
      const sent = await ctx.reply(
        renderMdHtml(ctx.t('support.transcript.sent_message')),
        { parse_mode: 'HTML' },
      );
      const chatId = sent.chat.id;
      const messageId = sent.message_id;
      setTimeout(() => {
        ctx.api.deleteMessage(chatId, messageId).catch((err) => {
          logger.warn(
            { err, chatId, messageId },
            'support.transcript.sent_message auto-delete failed',
          );
        });
      }, 5_000);
    } catch (err) {
      logger.error(
        { err, telegram_id: ctx.user.telegram_id },
        'support: send-transcript email flow failed',
      );
      await ctx.answerCallbackQuery({
        text: ctx.t('support.transcript.failed_popup', { email }),
        show_alert: true,
      });
    }
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
      pushTranscript({ at: new Date(), side: 'user', authorName: senderName, text });
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
      const mediaKind = ctx.message?.photo
        ? 'photo'
        : ctx.message?.video
          ? 'video'
          : ctx.message?.document
            ? 'document'
            : ctx.message?.voice
              ? 'voice'
              : ctx.message?.audio
                ? 'audio'
                : ctx.message?.sticker
                  ? 'sticker'
                  : 'media';
      const captionText = ctx.message?.caption ?? '';
      pushTranscript({
        at: new Date(),
        side: 'user',
        authorName: senderName,
        text: `[${mediaKind}]${captionText ? ` ${captionText}` : ''}`,
      });
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

    // Capture admin side of the conversation for the end-of-session
    // PDF transcript.
    if (typeof text === 'string') {
      pushTranscript({ at: new Date(), side: 'admin', authorName: 'Admin', text });
    } else {
      const adminMediaKind = ctx.message?.photo
        ? 'photo'
        : ctx.message?.video
          ? 'video'
          : ctx.message?.document
            ? 'document'
            : ctx.message?.voice
              ? 'voice'
              : ctx.message?.audio
                ? 'audio'
                : ctx.message?.sticker
                  ? 'sticker'
                  : 'media';
      const cap = ctx.message?.caption ?? '';
      pushTranscript({
        at: new Date(),
        side: 'admin',
        authorName: 'Admin',
        text: `[${adminMediaKind}]${cap ? ` ${cap}` : ''}`,
      });
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

/**
 * Default system prompt used when the admin hasn't customised one
 * via the `🤖 AI Setup → 💬 Set AI Prompt` button. The override
 * lives in the settings table under `text.ai.system_prompt`.
 */
const DEFAULT_AI_SYSTEM_PROMPT =
  "You are SafwanTiger Shop's helpful customer support assistant. " +
  'Be concise, friendly, and avoid making up information about ' +
  'products, prices, or order status — if you do not know, ask the ' +
  'customer to wait for a human admin to follow up.';

/**
 * Resolve the AI provider from the configured key shape. Google AI
 * Studio (Gemini) keys start with `AIza`; OpenAI keys start with
 * `sk-`. Falls back to OpenAI for unrecognised shapes so manually
 * pasted custom keys still hit a sensible endpoint.
 */
function aiProvider(key: string): 'google' | 'openai' {
  if (key.startsWith('AIza')) return 'google';
  return 'openai';
}

/**
 * Resolve the AI API key + system prompt the bot should use for
 * the one-shot AI Support replies.
 *
 * Priority:
 *   1. The runtime override set via the admin UI
 *      (`🤖 AI Setup → 🔑 Set AI API Key` → `text.ai.api_key`).
 *      This is what the bot owner expects to "just work" after
 *      pasting a key into Telegram.
 *   2. The legacy env var `OPENAI_API_KEY`, kept for backwards
 *      compatibility with deployments that wired the key at the
 *      Render / Railway env layer before the admin UI existed.
 */
function resolveAiConfig(): { key: string; prompt: string } | null {
  const override = getTextOverride('ai.api_key');
  const key = override && override.length > 0 ? override : env.OPENAI_API_KEY;
  if (!key) return null;
  const prompt = getTextOverride('ai.system_prompt') ?? DEFAULT_AI_SYSTEM_PROMPT;
  return { key, prompt };
}

async function callOpenAI(
  apiKey: string,
  prompt: string,
  question: string,
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: question },
      ],
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.warn({ status: res.status, body }, 'AI: OpenAI call failed');
    throw new Error(`OpenAI ${res.status}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? '🤖 (no answer)';
}

/**
 * Call Google AI Studio (Gemini) via the public REST endpoint.
 * Uses the `gemini-1.5-flash` model by default (free tier on AI
 * Studio at the time of writing). Override the model name by
 * setting `OPENAI_MODEL` to a Gemini model id (e.g.
 * `gemini-1.5-pro`) — the env var is reused as a generic
 * "preferred model" knob across providers.
 */
async function callGemini(
  apiKey: string,
  prompt: string,
  question: string,
): Promise<string> {
  // Reuse OPENAI_MODEL as a generic knob unless it still points at
  // an OpenAI default (`gpt-…`), in which case fall back to a
  // sensible Gemini default. Keeps the env surface minimal — no
  // need for a separate GEMINI_MODEL variable.
  const model = env.OPENAI_MODEL.startsWith('gpt-')
    ? 'gemini-1.5-flash'
    : env.OPENAI_MODEL;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt }] },
      contents: [{ role: 'user', parts: [{ text: question }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.warn({ status: res.status, body }, 'AI: Gemini call failed');
    throw new Error(`Gemini ${res.status}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim();
  return text && text.length > 0 ? text : '🤖 (no answer)';
}

async function answerAI(question: string): Promise<string> {
  const cfg = resolveAiConfig();
  if (!cfg) {
    return (
      '🤖 (AI not configured) An admin needs to paste an API key under ' +
      '*AI Setup → Set AI API Key* before this assistant can reply. ' +
      'A human will follow up shortly.'
    );
  }
  try {
    const provider = aiProvider(cfg.key);
    if (provider === 'google') {
      return await callGemini(cfg.key, cfg.prompt, question);
    }
    return await callOpenAI(cfg.key, cfg.prompt, question);
  } catch (err) {
    logger.error({ err }, 'AI: answerAI threw');
    return `🤖 ${(err as Error).message}`;
  }
}
