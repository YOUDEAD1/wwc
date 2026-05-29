import { Composer, InlineKeyboard, InputFile } from 'grammy';
import { env } from '../env.js';
import { inlineBtn, inlineUrl } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';
import { getAdminContactUrlWithPrefill } from '../services/settings.js';
import { logger } from '../logger.js';
import type { Lang } from '../../config/index.js';
import { deleteSetting, findUserById, readSetting, setSetting } from '../db/queries.js';
import * as adminLog from '../services/adminLog.js';
import { buildSupportTranscriptPdf } from '../services/pdfReport.js';
import { buildSupportTranscriptCsv } from '../services/csvReport.js';

// stub — kept so other files that import clearAiSession don't break
export function clearAiSession(_userId: number | undefined): void {}

type LiveUser = {
  telegram_id: number;
  first_name: string;
  username: string | null;
  userTopicId?: number;
  adminTopicId?: number;
  panelMessageId?: number;
};

let liveUser: LiveUser | null = null;

type TranscriptEntry = {
  at: Date;
  side: 'user' | 'admin';
  authorName: string;
  text: string;
};
let transcript: TranscriptEntry[] = [];
let sessionStartedAt: Date | null = null;

function pushTranscript(entry: TranscriptEntry): void {
  if (transcript.length >= 5000) return;
  transcript.push(entry);
}

const LIVE_SUPPORT_KEY = 'live_support.session';
const LIVE_SUPPORT_MAX_AGE_MS = 60 * 60 * 1000;

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
      started_at: sessionStartedAt?.toISOString() ?? null,
    });
  } catch (err) {
    logger.warn({ err }, 'live-support: failed to persist session');
  }
}

export async function restoreLiveSupportSession(): Promise<void> {
  try {
    const raw = await readSetting(LIVE_SUPPORT_KEY);
    if (!raw || typeof raw !== 'object') return;
    const obj = raw as Record<string, unknown>;
    const telegramId = Number(obj.telegram_id);
    if (!Number.isFinite(telegramId) || telegramId <= 0) return;
    const startedAtRaw = obj.started_at;
    const startedAtMs = typeof startedAtRaw === 'string' ? new Date(startedAtRaw).getTime() : NaN;
    const ageMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : Number.POSITIVE_INFINITY;
    if (ageMs > LIVE_SUPPORT_MAX_AGE_MS) {
      await deleteSetting(LIVE_SUPPORT_KEY);
      return;
    }
    liveUser = {
      telegram_id: telegramId,
      first_name: typeof obj.first_name === 'string' ? obj.first_name : '—',
      username: typeof obj.username === 'string' ? obj.username : null,
      userTopicId: obj.user_topic_id != null ? Number(obj.user_topic_id) : undefined,
      adminTopicId: obj.admin_topic_id != null ? Number(obj.admin_topic_id) : undefined,
      panelMessageId: obj.panel_message_id != null ? Number(obj.panel_message_id) : undefined,
    };
    sessionStartedAt = Number.isFinite(startedAtMs) ? new Date(startedAtMs) : new Date();
    logger.info({ telegramId }, 'live-support: restored persisted session from DB');
  } catch (err) {
    logger.warn({ err }, 'live-support: failed to restore persisted session');
  }
}

export async function forceClearLiveSupport(ctx: AppCtx): Promise<{ cleared: boolean; userId: number | null }> {
  const target = liveUser;
  liveUser = null;
  sessionStartedAt = null;
  transcript = [];
  await persistLiveUser();
  if (!target) return { cleared: false, userId: null };
  await tryDeleteTopic(ctx, target.telegram_id, target.userTopicId);
  await tryDeleteTopic(ctx, env.ADMIN_USER_ID, target.adminTopicId);
  await teardownPanel(ctx, target.telegram_id, target.panelMessageId);
  return { cleared: true, userId: target.telegram_id };
}

const TOPIC_NAME_USER = 'Live Support';
const TOPIC_ICON_COLOR = 0x6fb9f0;

function liveKeyboardForUser(lang: Lang): InlineKeyboard {
  return inlineBtn(new InlineKeyboard(), lang, 'support_cancel', 'support:live:cancel:user');
}

function liveKeyboardForAdmin(lang: Lang): InlineKeyboard {
  return inlineBtn(new InlineKeyboard(), lang, 'support_end_session', 'support:live:end:admin');
}

function supportKeyboard(contactUrl: string, lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  inlineUrl(kb, lang, 'support_contact', contactUrl);
  kb.row();
  inlineBtn(kb, lang, 'support_live', 'support:live:start');
  kb.row();
  inlineBtn(kb, lang, 'back', 'main:open');
  return kb;
}

async function tryCreateTopic(ctx: AppCtx, chatId: number, name: string): Promise<number | undefined> {
  try {
    const topic = await ctx.api.createForumTopic(chatId, name, { icon_color: TOPIC_ICON_COLOR });
    return topic.message_thread_id;
  } catch (err) {
    logger.warn({ err, chatId, name }, 'live-support: createForumTopic failed');
    return undefined;
  }
}

async function tryDeleteTopic(ctx: AppCtx, chatId: number, threadId: number | undefined): Promise<void> {
  if (!threadId) return;
  try { await ctx.api.deleteForumTopic(chatId, threadId); return; }
  catch (err) { logger.warn({ err }, 'live-support: deleteForumTopic failed, retrying'); }
  try { await ctx.api.deleteForumTopic(chatId, threadId); }
  catch (err) { logger.error({ err }, 'live-support: deleteForumTopic failed after retry'); }
}

async function teardownPanel(ctx: AppCtx, userTelegramId: number, panelMessageId: number | undefined): Promise<void> {
  if (!panelMessageId) return;
  try { await ctx.api.unpinChatMessage(userTelegramId, panelMessageId); } catch (err) { logger.warn({ err }, 'live-support: failed to unpin panel'); }
  try { await ctx.api.deleteMessage(userTelegramId, panelMessageId); } catch (err) { logger.warn({ err }, 'live-support: failed to delete panel'); }
}

async function endSession(ctx: AppCtx, endedBy: 'user' | 'admin'): Promise<void> {
  const target = liveUser;
  const startedAt = sessionStartedAt ?? new Date();
  const messagesSnapshot = transcript.slice();
  liveUser = null;
  transcript = [];
  sessionStartedAt = null;
  await persistLiveUser();
  if (!target) return;

  if (endedBy === 'user' && ctx.session?.userFlow?.type === 'live_support') {
    ctx.session.userFlow = undefined;
  }

  await tryDeleteTopic(ctx, target.telegram_id, target.userTopicId);
  await tryDeleteTopic(ctx, env.ADMIN_USER_ID, target.adminTopicId);
  await teardownPanel(ctx, target.telegram_id, target.panelMessageId);

  const endedAt = new Date();
  const durationSec = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));

  let pdfBuffer: Buffer | null = null;
  let pdfFilename = '';
  try {
    const transcriptArgs = {
      sessionStartedAt: startedAt,
      sessionEndedAt: endedAt,
      user: { telegram_id: target.telegram_id, first_name: target.first_name, username: target.username },
      endedBy,
      entries: messagesSnapshot.map((e) => ({ at: e.at, side: e.side, author: e.authorName, text: e.text })),
    };
    pdfBuffer = await buildSupportTranscriptPdf(transcriptArgs);
    const csvBuffer = buildSupportTranscriptCsv(transcriptArgs);
    const safeName = (target.username ?? `user_${target.telegram_id}`).replace(/[^A-Za-z0-9_-]/g, '_');
    pdfFilename = `live_support_${safeName}_${startedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pdf`;
    void csvBuffer;
  } catch (err) {
    logger.warn({ err }, 'live-support: failed to build transcript PDF');
  }

  let userLang: Lang = ctx.lang;
  try {
    const userRow = await findUserById(target.telegram_id);
    if (userRow?.language) userLang = userRow.language;
  } catch (err) {
    logger.warn({ err }, 'live-support: failed to load user lang');
  }
  void userLang;

  try {
    await ctx.api.sendMessage(target.telegram_id, renderMdHtml(ctx.t('support.live.user_ended')), { parse_mode: 'HTML' });
  } catch (err) { logger.warn({ err }, 'live-support: failed to notify user of end'); }

  try {
    await ctx.api.sendMessage(env.ADMIN_USER_ID, renderMdHtml(ctx.t('support.live.admin_ended')), { parse_mode: 'HTML' });
  } catch (err) { logger.warn({ err }, 'live-support: failed to notify admin of end'); }

  void adminLog.logSupportEnd(ctx.api, {
    user: { telegram_id: target.telegram_id, username: target.username, first_name: target.first_name, email: null },
    endedBy, durationSeconds: durationSec, messageCount: messagesSnapshot.length,
  });

  if (pdfBuffer) {
    try {
      await adminLog.logSupportTranscript(ctx.api, {
        user: { telegram_id: target.telegram_id, username: target.username, first_name: target.first_name, email: null },
        durationSeconds: durationSec, messageCount: messagesSnapshot.length,
        pdf: new InputFile(pdfBuffer, pdfFilename),
      });
    } catch (err) { logger.warn({ err }, 'live-support: failed to send transcript PDF'); }
  }
}

export function registerSupport(bot: Composer<AppCtx>): void {
  bot.on('message:forum_topic_created', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    const topicName = ctx.message?.forum_topic_created?.name;
    if (topicName === TOPIC_NAME_USER || (topicName !== undefined && topicName.startsWith(`${TOPIC_NAME_USER} — `))) return next();
    const threadId = ctx.message?.message_thread_id;
    if (!threadId) return next();
    try { await ctx.api.deleteForumTopic(ctx.chat.id, threadId); }
    catch (err) { logger.warn({ err }, 'live-support: failed to auto-delete stray topic'); }
  });

  bot.callbackQuery('support:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    const text = `${ctx.t('support.title')}\n\n${ctx.t('support.body')}`;
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: supportKeyboard(getAdminContactUrlWithPrefill(ctx.t('support.contact_prefill')), ctx.lang),
    });
  });

  bot.callbackQuery('support:live:start', async (ctx) => {
    if (liveUser !== null && liveUser.telegram_id !== ctx.user.telegram_id) {
      const ageMs = sessionStartedAt ? Date.now() - sessionStartedAt.getTime() : Number.POSITIVE_INFINITY;
      if (ageMs > LIVE_SUPPORT_MAX_AGE_MS) {
        const stale = liveUser;
        liveUser = null; sessionStartedAt = null; transcript = [];
        await persistLiveUser();
        await tryDeleteTopic(ctx, stale.telegram_id, stale.userTopicId);
        await tryDeleteTopic(ctx, env.ADMIN_USER_ID, stale.adminTopicId);
        await teardownPanel(ctx, stale.telegram_id, stale.panelMessageId);
      } else {
        await ctx.answerCallbackQuery({ text: ctx.t('support.live.busy_popup'), show_alert: true });
        return;
      }
    }

    if (liveUser !== null && liveUser.telegram_id === ctx.user.telegram_id) {
      const prev = liveUser; liveUser = null;
      await persistLiveUser();
      await tryDeleteTopic(ctx, prev.telegram_id, prev.userTopicId);
      await tryDeleteTopic(ctx, env.ADMIN_USER_ID, prev.adminTopicId);
      await teardownPanel(ctx, prev.telegram_id, prev.panelMessageId);
    }

    await ctx.answerCallbackQuery();
    liveUser = { telegram_id: ctx.user.telegram_id, first_name: ctx.user.first_name ?? '—', username: ctx.user.username ?? null };
    transcript = [];
    sessionStartedAt = new Date();

    const userTopicId = await tryCreateTopic(ctx, ctx.user.telegram_id, TOPIC_NAME_USER);
    if (liveUser) liveUser.userTopicId = userTopicId;
    const adminTopicId = await tryCreateTopic(ctx, env.ADMIN_USER_ID, `${TOPIC_NAME_USER} — ${liveUser.first_name}`);
    if (liveUser) liveUser.adminTopicId = adminTopicId;

    try { await ctx.deleteMessage(); } catch (err) { logger.warn({ err }, 'live-support: failed to delete support menu'); }

    let panelMessageId: number | undefined;
    const panelInTopic = userTopicId !== undefined;
    try {
      const panel = await ctx.api.sendMessage(ctx.user.telegram_id, renderMdHtml(ctx.t('support.live.user_active')), {
        parse_mode: 'HTML',
        ...(userTopicId ? { message_thread_id: userTopicId } : {}),
        reply_markup: liveKeyboardForUser(ctx.lang),
      });
      panelMessageId = panel.message_id;
      try { await ctx.api.pinChatMessage(ctx.user.telegram_id, panelMessageId, { disable_notification: true }); }
      catch (err) { logger.warn({ err }, 'live-support: failed to pin panel'); }
    } catch (err) { logger.error({ err }, 'live-support: failed to send panel message'); }
    if (liveUser) liveUser.panelMessageId = panelInTopic ? undefined : panelMessageId;

    await persistLiveUser();

    void adminLog.logSupportStart(ctx.api, {
      user: { telegram_id: ctx.user.telegram_id, username: ctx.user.username ?? null, first_name: ctx.user.first_name ?? null, email: ctx.user.email ?? null },
      userTopicId, adminTopicId,
    });

    let adminReachable = true;
    try {
      const adminMsg = ctx.t('support.live.admin_started', { name: liveUser.first_name, username: liveUser.username ?? '—', id: String(liveUser.telegram_id) });
      await ctx.api.sendMessage(env.ADMIN_USER_ID, renderMdHtml(adminMsg), {
        parse_mode: 'HTML',
        ...(adminTopicId ? { message_thread_id: adminTopicId } : {}),
        reply_markup: liveKeyboardForAdmin(ctx.lang),
      });
    } catch (err) {
      adminReachable = false;
      logger.error({ err }, 'live-support: failed to notify admin — aborting session');
    }

    if (!adminReachable) {
      const aborted = liveUser;
      liveUser = null; sessionStartedAt = null; transcript = [];
      await persistLiveUser();
      if (aborted) {
        await tryDeleteTopic(ctx, aborted.telegram_id, aborted.userTopicId);
        await tryDeleteTopic(ctx, env.ADMIN_USER_ID, aborted.adminTopicId);
        if (aborted.userTopicId === undefined && panelMessageId !== undefined) await teardownPanel(ctx, aborted.telegram_id, panelMessageId);
      }
      try { await ctx.answerCallbackQuery({ text: ctx.t('support.live.unavailable_popup'), show_alert: true }); } catch { /* already answered */ }
      try { await ctx.api.sendMessage(ctx.user.telegram_id, renderMdHtml(ctx.t('support.live.unavailable_message')), { parse_mode: 'HTML' }); }
      catch (sendErr) { logger.warn({ err: sendErr }, 'live-support: failed to send unavailable_message'); }
      return;
    }

    ctx.session.userFlow = {
      type: 'live_support', step: 'connected',
      data: { startedAt: Date.now(), panelMessageId: panelInTopic ? undefined : panelMessageId, userTopicId, adminTopicId },
    };
  });

  bot.callbackQuery('support:live:cancel:user', async (ctx) => {
    await ctx.answerCallbackQuery();
    const wasActive = liveUser?.telegram_id === ctx.user.telegram_id;
    if (wasActive) { await endSession(ctx, 'user'); return; }
    const flow = ctx.session?.userFlow;
    if (flow?.type === 'live_support') {
      const { panelMessageId, userTopicId, adminTopicId } = flow.data;
      ctx.session.userFlow = undefined;
      if (ctx.chat) { await tryDeleteTopic(ctx, ctx.chat.id, userTopicId); await teardownPanel(ctx, ctx.chat.id, panelMessageId); }
      await tryDeleteTopic(ctx, env.ADMIN_USER_ID, adminTopicId);
    } else { ctx.session.userFlow = undefined; }
    try { await ctx.deleteMessage(); } catch (err) { logger.warn({ err }, 'live-support: failed to delete stale cancel button'); }
    await ctx.reply(renderMdHtml(ctx.t('support.live.user_ended')), { parse_mode: 'HTML' });
  });

  bot.callbackQuery('support:live:end:admin', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.from?.id !== env.ADMIN_USER_ID) return;
    await endSession(ctx, 'admin');
  });

  bot.command('end', async (ctx, next) => {
    if (ctx.from?.id !== env.ADMIN_USER_ID) return next();
    if (liveUser === null) return next();
    await endSession(ctx, 'admin');
  });

  bot.command('clearsupport', async (ctx, next) => {
    if (ctx.from?.id !== env.ADMIN_USER_ID) return next();
    const result = await forceClearLiveSupport(ctx);
    const body = result.cleared
      ? `🧹 Live Support slot force-cleared (was held by user \`${result.userId}\`).`
      : '🧹 No active Live Support slot to clear.';
    try { await ctx.reply(body, { parse_mode: 'Markdown' }); }
    catch (err) { logger.warn({ err }, 'live-support: /clearsupport reply failed'); }
  });

  // User → Admin relay
  bot.on('message', async (ctx, next) => {
    if (ctx.from?.id === env.ADMIN_USER_ID) return next();
    if (liveUser === null || liveUser.telegram_id !== ctx.from?.id) return next();
    if (ctx.message?.forum_topic_created || ctx.message?.forum_topic_edited || ctx.message?.forum_topic_closed || ctx.message?.forum_topic_reopened) return next();
    const text = ctx.message?.text;
    if (typeof text === 'string' && text.startsWith('/')) return next();

    const senderName = liveUser.first_name;
    const tryRelay = async (a: () => Promise<unknown>, b: () => Promise<unknown>) => {
      try { await a(); } catch (err) {
        logger.warn({ err }, 'live-support: relay to admin topic failed, retrying');
        try { await b(); } catch (err2) { logger.error({ err: err2 }, 'live-support: relay to admin General also failed'); }
      }
    };

    if (typeof text === 'string') {
      pushTranscript({ at: new Date(), side: 'user', authorName: senderName, text });
      const html = renderMdHtml(ctx.t('support.live.admin_relay', { name: senderName, text }));
      await tryRelay(
        () => ctx.api.sendMessage(env.ADMIN_USER_ID, html, { parse_mode: 'HTML', ...(liveUser?.adminTopicId ? { message_thread_id: liveUser.adminTopicId } : {}) }),
        () => ctx.api.sendMessage(env.ADMIN_USER_ID, html, { parse_mode: 'HTML' }),
      );
    } else {
      const mediaKind = ctx.message?.photo ? 'photo' : ctx.message?.video ? 'video' : ctx.message?.document ? 'document' : ctx.message?.voice ? 'voice' : ctx.message?.audio ? 'audio' : ctx.message?.sticker ? 'sticker' : 'media';
      const captionText = ctx.message?.caption ?? '';
      pushTranscript({ at: new Date(), side: 'user', authorName: senderName, text: `[${mediaKind}]${captionText ? ` ${captionText}` : ''}` });
      const headerHtml = renderMdHtml(ctx.t('support.live.admin_media_header', { name: senderName }));
      const adminTopicOpt = liveUser?.adminTopicId ? { message_thread_id: liveUser.adminTopicId } : {};
      await tryRelay(
        async () => { await ctx.api.sendMessage(env.ADMIN_USER_ID, headerHtml, { parse_mode: 'HTML', ...adminTopicOpt }); await ctx.api.copyMessage(env.ADMIN_USER_ID, ctx.chat!.id, ctx.message!.message_id, adminTopicOpt); },
        async () => { await ctx.api.sendMessage(env.ADMIN_USER_ID, headerHtml, { parse_mode: 'HTML' }); await ctx.api.copyMessage(env.ADMIN_USER_ID, ctx.chat!.id, ctx.message!.message_id); },
      );
    }
  });

  // Admin → User relay
  bot.on('message', async (ctx, next) => {
    if (ctx.from?.id !== env.ADMIN_USER_ID) return next();
    if (liveUser === null) return next();
    if (ctx.session?.adminFlow) return next();
    if (ctx.message?.forum_topic_created || ctx.message?.forum_topic_edited || ctx.message?.forum_topic_closed || ctx.message?.forum_topic_reopened) return next();
    const text = ctx.message?.text;
    if (typeof text === 'string' && text.startsWith('/')) return next();
    const messageThreadId = ctx.message?.message_thread_id;
    if (liveUser.adminTopicId && messageThreadId !== liveUser.adminTopicId) return next();

    if (typeof text === 'string') {
      pushTranscript({ at: new Date(), side: 'admin', authorName: 'Admin', text });
    } else {
      const k = ctx.message?.photo ? 'photo' : ctx.message?.video ? 'video' : ctx.message?.document ? 'document' : ctx.message?.voice ? 'voice' : ctx.message?.audio ? 'audio' : ctx.message?.sticker ? 'sticker' : 'media';
      const cap = ctx.message?.caption ?? '';
      pushTranscript({ at: new Date(), side: 'admin', authorName: 'Admin', text: `[${k}]${cap ? ` ${cap}` : ''}` });
    }

    const userThreadOpt = liveUser.userTopicId ? { message_thread_id: liveUser.userTopicId } : {};
    try { await ctx.api.copyMessage(liveUser.telegram_id, ctx.chat!.id, ctx.message!.message_id, userThreadOpt); }
    catch (err) {
      logger.warn({ err }, 'live-support: relay to user topic failed, retrying');
      try { await ctx.api.copyMessage(liveUser.telegram_id, ctx.chat!.id, ctx.message!.message_id); }
      catch (err2) { logger.error({ err: err2 }, 'live-support: relay to user General also failed'); }
    }
  });
}