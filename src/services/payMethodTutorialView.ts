/**
 * User-facing renderer for the per-payment-method tutorial card.
 *
 * Mirrors the bot-tutorial render in `profile.ts` and the product
 * "Using Method" render in `shop.ts`: ack the callback first, send a
 * brand-new HTML message (not an edit) with an optional URL button,
 * then optionally re-send the admin-uploaded photo / video / document
 * as a follow-up message. Errors never throw — every failure falls
 * back to a polite "couldn't load this tutorial" stub so the buyer
 * isn't left staring at a perpetual spinner.
 *
 * The card is admin-editable from /admin → Payment Methods → "📘 #N
 * Tutorial" and stored in the `settings` table under
 * `pay_tutorial.<methodId>.{text,file_id,file_type,url}` (see
 * `services/settings.ts`).
 */
import { InlineKeyboard } from 'grammy';
import type { AppCtx } from '../middleware/user.js';
import { btn, inlineUrl } from '../keyboards/helpers.js';
import {
  clampForTelegram,
  escapeAttr,
  htmlToPlain,
  renderMdHtml,
  sanitizeButtonUrl,
} from './premium.js';
import { getPaymentMethodTutorial } from './settings.js';
import { logger } from '../logger.js';

/**
 * Send the per-method tutorial card as a NEW message (not an edit) so
 * the buyer's instruction screen — which still has the address /
 * Pay ID / locked LTC quote — stays visible above the tutorial. The
 * `backCallback` is wired into the tutorial card's "⬅️ Back" row so
 * tapping it re-opens whichever screen the user came from (top-up
 * picker, direct-pay picker, etc.) without mutating the underlying
 * deposit row.
 */
export async function renderPaymentMethodTutorial(
  ctx: AppCtx,
  methodId: number,
  methodName: string,
  backCallback: string,
): Promise<void> {
  // Always ack first so Telegram never shows a perpetual spinner
  // even if the body below throws.
  await ctx.answerCallbackQuery();
  let stage = 'load_settings';
  try {
    const tut = getPaymentMethodTutorial(methodId);
    stage = 'compose_body';
    const text = (tut.text ?? '').trim();
    const titleLine = ctx.t('pay.tutorial.title', { method: methodName });
    const body =
      text.length > 0
        ? `${titleLine}\n\n${ctx.t('pay.tutorial.body', { body: text })}`
        : `${titleLine}\n\n${ctx.t('pay.tutorial.empty')}`;
    stage = 'build_keyboard';
    const safeUrl = sanitizeButtonUrl(tut.url);
    const kb = new InlineKeyboard();
    if (safeUrl) {
      inlineUrl(kb, ctx.lang, 'tutorial_open_link', safeUrl);
      kb.row();
    }
    kb.text(btn(ctx.lang, 'back'), backCallback);
    stage = 'render_html';
    const html = renderMdHtml(body);
    const safeHtml = clampForTelegram(html);
    logger.info(
      {
        methodId,
        hasText: text.length > 0,
        hasFile: Boolean(tut.file_id && tut.file_type),
        fileType: tut.file_type ?? null,
        hasUrl: Boolean(safeUrl),
        rejectedUrl: tut.url && !safeUrl ? tut.url : null,
        htmlLen: safeHtml.length,
      },
      'paytut: — rendering payment method tutorial',
    );
    stage = 'send_html';
    try {
      await ctx.reply(safeHtml, {
        parse_mode: 'HTML',
        reply_markup: kb,
        link_preview_options: { is_disabled: true },
      });
    } catch (htmlErr) {
      logger.warn(
        { err: htmlErr, methodId },
        'paytut: HTML send failed, retrying as plain text',
      );
      stage = 'send_plain';
      await ctx.reply(htmlToPlain(safeHtml), {
        reply_markup: kb,
        link_preview_options: { is_disabled: true },
      });
    }
    if (tut.file_id && tut.file_type) {
      try {
        stage = 'send_file';
        if (tut.file_type === 'photo') {
          await ctx.replyWithPhoto(tut.file_id);
        } else if (tut.file_type === 'video') {
          await ctx.replyWithVideo(tut.file_id);
        } else {
          await ctx.replyWithDocument(tut.file_id);
        }
      } catch (err) {
        logger.warn({ err, methodId }, 'paytut: file send failed');
      }
    }
  } catch (err) {
    logger.error({ err, methodId, stage }, 'paytut: failed to render');
    const reason = (err as Error)?.message ?? String(err);
    try {
      await ctx.reply(
        `⚠️ <b>Couldn't load this tutorial.</b>\n\n` +
          `Stage: <code>${escapeAttr(stage)}</code>\n` +
          `Reason: <code>${escapeAttr(reason).slice(0, 200)}</code>\n\n` +
          `Admin: open <code>/admin</code> → <i>Payment Methods → 📘 #${methodId} Tutorial → Set Text / Set File / Set URL</i> and double-check the URL (must start with <code>https://</code> and contain no spaces or newlines).`,
        { parse_mode: 'HTML' },
      );
    } catch {
      // Last-ditch: nothing else to do.
    }
  }
}
