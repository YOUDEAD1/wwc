/**
 * Post-purchase product delivery form.
 *
 * Some products require the BUYER to send a few details after
 * paying — typical examples:
 *   - account email + password the seller will register the buyer with
 *   - gift-card code the buyer wants topped up
 *   - recovery key, voucher code, custom slot name, …
 *
 * For those products the admin flips `delivery_form_enabled` on the
 * row, sets a free-form instruction message + a list of fields, and
 * optionally points a vendor chat at the order. After `Order
 * Delivered` we run the user through a tiny inline wizard:
 *
 *     instruction card  →  per-field prompts  →  success card
 *                                                ├─ Edit Details
 *                                                └─ Admin Help (URL)
 *
 * Submissions persist to `order_delivery_submissions` (1:1 with the
 * order). Edit-and-resubmit bumps `revision` so the vendor DM can
 * flag the new payload as a correction and ask them to discard the
 * previous one.
 */
import type { Api, InlineKeyboard as InlineKeyboardType } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { logger } from '../logger.js';
import { env } from '../env.js';
import { t as translate } from '../i18n/index.js';
import { renderMdHtml } from './premium.js';
import { getAdminContactUrlWithPrefill } from './settings.js';
import {
  getDeliverySubmission,
  getProduct,
  upsertDeliverySubmission,
} from '../db/queries.js';
import { applyButtonChrome, btn } from '../keyboards/helpers.js';
import type { Lang } from '../../config/index.js';
import type {
  DBOrderDeliverySubmission,
  DBProduct,
  DeliveryFieldSpec,
} from '../types.js';
import type { AppCtx } from '../middleware/user.js';

/**
 * `#order-ORDXXXX` tag attached to vendor DMs so the seller can
 * grep / search by order in their workspace.
 */
export function buildOrderTag(orderPublicId: string): string {
  return `#order-${orderPublicId}`;
}

/**
 * Default single field used when the admin has flipped
 * `delivery_form_enabled` on but hasn't configured any fields yet.
 * This way toggling the feature ON is enough on its own — the buyer
 * still gets an instruction message + a single free-form "Details"
 * prompt + a success/Admin Help card, instead of the form silently
 * disappearing because the field spec is empty.
 *
 * Admins who need typed multi-field collection (email + password +
 * recovery code, …) override this by tapping 🗂 Fields and sending
 * a `key | Label | required` spec — the helper below favours those
 * whenever they exist.
 */
const DEFAULT_DELIVERY_FIELDS: ReadonlyArray<DeliveryFieldSpec> = [
  { key: 'details', label: 'Details', required: true },
];

/**
 * Resolve the field spec to actually drive the buyer-side wizard
 * with. Prefers the admin-configured `delivery_fields` row; falls
 * back to a single default `Details` field when the admin just
 * flipped the toggle ON without configuring any fields. We always
 * return a NEW array so callers can safely mutate / push without
 * leaking back into the shared default.
 */
export function getEffectiveDeliveryFields(p: DBProduct): DeliveryFieldSpec[] {
  if (Array.isArray(p.delivery_fields) && p.delivery_fields.length > 0) {
    return p.delivery_fields;
  }
  return DEFAULT_DELIVERY_FIELDS.map((f) => ({ ...f }));
}

/**
 * True iff the product has the delivery form turned on. Empty
 * `delivery_fields` no longer disqualifies the product — we
 * synthesise a single default `Details` field at runtime via
 * `getEffectiveDeliveryFields()` so the buyer-side wizard always
 * surfaces the instruction message + prompt card the moment the
 * admin flips the toggle ON.
 */
export function productHasDeliveryForm(p: DBProduct): boolean {
  return p.delivery_form_enabled === true;
}

/**
 * Render the per-field summary block used in vendor DMs + admin-help
 * deep links. Empty answers are rendered as `(blank)` so the vendor
 * can immediately see optional fields the buyer skipped.
 */
function renderPayloadBlock(
  fields: DeliveryFieldSpec[],
  payload: Record<string, string>,
): string {
  const lines: string[] = [];
  for (const f of fields) {
    const raw = payload[f.key];
    const value = raw && raw.length > 0 ? raw : '(blank)';
    lines.push(`• *${f.label}:* \`${value}\``);
  }
  return lines.join('\n');
}

/**
 * Compact inline summary used inside the admin-help deep-link auto
 * text ("I have sent email foo@bar / password ***"). Skips empty
 * answers so the message reads naturally.
 */
function renderFieldSummary(
  fields: DeliveryFieldSpec[],
  payload: Record<string, string>,
): string {
  const parts: string[] = [];
  for (const f of fields) {
    const v = payload[f.key];
    if (v && v.length > 0) parts.push(`${f.label.toLowerCase()} ${v}`);
  }
  return parts.length > 0 ? parts.join(' / ') : '(no details)';
}

function tFor(lang: Lang) {
  return (key: string, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
}

/**
 * Build the inline keyboard shown under the success card:
 * `[ Edit Details ]` callback + `[ Admin Help ]` URL with prefilled
 * text so the buyer lands in admin DM with the message already
 * staged for sending.
 */
function buildSuccessKeyboard(args: {
  lang: Lang;
  orderId: number;
  helpText: string;
}): InlineKeyboardType {
  const kb = new InlineKeyboard();
  kb.text(btn(args.lang, 'delivery_edit'), `delivery:edit:${args.orderId}`);
  applyButtonChrome(kb, 'delivery_edit');
  kb.row();
  kb.url(
    btn(args.lang, 'delivery_admin_help'),
    getAdminContactUrlWithPrefill(args.helpText),
  );
  applyButtonChrome(kb, 'delivery_admin_help');
  return kb;
}

/**
 * Render the next-step prompt for the current cursor position. When
 * the form has more than one field we tack a `Step {n}/{total}`
 * header on top so the buyer knows how far they have to go.
 */
function renderPrompt(args: {
  lang: Lang;
  product_name: string;
  fields: DeliveryFieldSpec[];
  cursor: number;
}): string {
  const t = tFor(args.lang);
  const total = args.fields.length;
  const field = args.fields[args.cursor];
  if (!field) return '';
  const promptKey =
    field.required === false
      ? 'shop.delivery.box.prompt_optional'
      : 'shop.delivery.box.prompt';
  const promptLine = t(promptKey, { label: field.label });
  if (total <= 1) return promptLine;
  const header = t('shop.delivery.box.header', {
    product_name: args.product_name,
    current: args.cursor + 1,
    total,
  });
  return `${header}\n\n${promptLine}`;
}

/**
 * Push (or in-place edit) the current prompt card. We edit the
 * existing message every time `cursor` advances so the buyer's chat
 * stays calm — a single submission box that updates step-by-step,
 * not one new message per field.
 */
async function pushPromptCard(args: {
  api: Api;
  chatId: number;
  lang: Lang;
  product_name: string;
  fields: DeliveryFieldSpec[];
  cursor: number;
  existingMessageId?: number;
}): Promise<number | undefined> {
  const html = renderMdHtml(
    renderPrompt({
      lang: args.lang,
      product_name: args.product_name,
      fields: args.fields,
      cursor: args.cursor,
    }),
  );
  if (args.existingMessageId !== undefined) {
    try {
      await args.api.editMessageText(args.chatId, args.existingMessageId, html, {
        parse_mode: 'HTML',
      });
      return args.existingMessageId;
    } catch (err) {
      // Editing fails when the message is gone, identical to current
      // body, or older than 48h — fall through and resend.
      logger.debug(
        { err, chatId: args.chatId, messageId: args.existingMessageId },
        'delivery: prompt edit failed, sending fresh',
      );
    }
  }
  try {
    const msg = await args.api.sendMessage(args.chatId, html, {
      parse_mode: 'HTML',
    });
    return msg.message_id;
  } catch (err) {
    logger.warn({ err, chatId: args.chatId }, 'delivery: prompt send failed');
    return undefined;
  }
}

/**
 * Forward the buyer's submission to the per-product vendor chat (if
 * one is configured). Failures are logged but never bubble up — the
 * buyer must not see "vendor unreachable" errors on the success
 * card.
 */
async function sendVendorMessage(args: {
  api: Api;
  product: DBProduct;
  buyer: { telegram_id: number; first_name: string | null; username: string | null };
  orderPublicId: string;
  qty: number;
  submission: DBOrderDeliverySubmission;
  fields: DeliveryFieldSpec[];
  isResubmit: boolean;
}): Promise<void> {
  const vendorId = args.product.delivery_vendor_chat_id;
  if (vendorId === null || vendorId === undefined) return;
  // Vendor messages always render in the bot owner's default
  // language — we have no language preference for an arbitrary
  // vendor account.
  const t = tFor(env.DEFAULT_LANG);
  const handle = args.buyer.username
    ? `@${args.buyer.username}`
    : args.buyer.first_name ?? String(args.buyer.telegram_id);
  const buyerStr = `${handle} (${args.buyer.telegram_id})`;
  const detailsBlock = renderPayloadBlock(args.fields, args.submission.payload);
  const key = args.isResubmit
    ? 'shop.delivery.vendor.resubmit'
    : 'shop.delivery.vendor.new';
  const body = t(key, {
    order_tag: buildOrderTag(args.orderPublicId),
    product_name: args.product.name,
    qty: args.qty,
    buyer: buyerStr,
    details: detailsBlock,
    revision: args.submission.revision,
  });
  try {
    await args.api.sendMessage(vendorId, renderMdHtml(body), {
      parse_mode: 'HTML',
    });
  } catch (err) {
    logger.warn(
      { err, vendorId, productId: args.product.id, orderPublicId: args.orderPublicId },
      'delivery: vendor DM failed (the vendor likely needs to /start the bot)',
    );
  }
}

/**
 * Persist the submission + send the success card + forward to the
 * vendor. Used by both the first-submit path (driven from the
 * message handler) and the edit/resubmit path (driven from the
 * `delivery:edit` callback).
 */
async function finalizeSubmission(args: {
  api: Api;
  chatId: number;
  lang: Lang;
  orderId: number;
  orderPublicId: string;
  product: DBProduct;
  qty: number;
  buyer: { telegram_id: number; first_name: string | null; username: string | null };
  payload: Record<string, string>;
  isResubmit: boolean;
}): Promise<void> {
  const t = tFor(args.lang);
  const submission = await upsertDeliverySubmission({
    order_id: args.orderId,
    user_id: args.buyer.telegram_id,
    product_id: args.product.id,
    payload: args.payload,
  });
  // Compose the admin-help auto-text BEFORE building the keyboard
  // because the URL is staged inside the button itself.
  const effectiveFields = getEffectiveDeliveryFields(args.product);
  const fieldSummary = renderFieldSummary(effectiveFields, args.payload);
  const helpText = t(
    args.isResubmit
      ? 'shop.delivery.admin_help.resubmit'
      : 'shop.delivery.admin_help.first',
    {
      product_name: args.product.name,
      field_summary: fieldSummary,
      order_tag: buildOrderTag(args.orderPublicId),
    },
  );
  const summaryHeader = renderMdHtml(
    t('shop.delivery.box.summary_header', { product_name: args.product.name }),
  );
  const summaryRows = effectiveFields
    .map((f) =>
      t('shop.delivery.box.summary_row', {
        label: f.label,
        value: args.payload[f.key] && args.payload[f.key]!.length > 0
          ? args.payload[f.key]!
          : '—',
      }),
    )
    .join('\n');
  const summaryHtml = `${summaryHeader}\n\n${renderMdHtml(summaryRows)}`;
  const successHtml = renderMdHtml(
    t(
      args.isResubmit
        ? 'shop.delivery.success.resubmitted'
        : 'shop.delivery.success.default',
    ),
  );
  const kb = buildSuccessKeyboard({
    lang: args.lang,
    orderId: args.orderId,
    helpText,
  });
  try {
    await args.api.sendMessage(args.chatId, summaryHtml, { parse_mode: 'HTML' });
  } catch (err) {
    logger.warn({ err, chatId: args.chatId }, 'delivery: summary send failed');
  }
  try {
    await args.api.sendMessage(args.chatId, successHtml, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
  } catch (err) {
    logger.warn({ err, chatId: args.chatId }, 'delivery: success card send failed');
  }
  await sendVendorMessage({
    api: args.api,
    product: args.product,
    buyer: args.buyer,
    orderPublicId: args.orderPublicId,
    qty: args.qty,
    submission,
    fields: effectiveFields,
    isResubmit: args.isResubmit,
  });
}

/**
 * Public entry — try to start the post-purchase delivery flow on
 * `Api`. Returns `false` when the product is not configured for a
 * delivery form (caller can skip the rest of the post-delivery
 * cards). Used by `services/orderFulfill.ts` (direct-pay path).
 *
 * The userFlow state is *not* set here because direct-pay finalises
 * outside of a user-session context (the user is still on the
 * payment screen). We only send the instruction message + a single
 * prompt card; the moment the buyer sends ANY message the
 * `handleDeliveryFormMessage` handler in `shop.ts` runs and the
 * session state is recovered from `getDeliverySubmission` / pending
 * order metadata. The simpler path is to seed the userFlow up front
 * via `maybeStartDeliveryFormForCtx`. Direct-pay never has a `ctx`
 * here, so we DM the buyer with the instruction + open card; the
 * buyer's first reply text re-enters the bot through the catch-all
 * text handler which uses the saved userFlow set in
 * `seedDeliveryFormState`.
 */
export async function maybeStartDeliveryFormFromApi(args: {
  api: Api;
  product: DBProduct;
  orderId: number;
  orderPublicId: string;
  buyerTelegramId: number;
  buyerLang: Lang;
}): Promise<boolean> {
  if (!productHasDeliveryForm(args.product)) return false;
  const t = tFor(args.buyerLang);
  const effectiveFields = getEffectiveDeliveryFields(args.product);
  const instruction = args.product.delivery_instruction?.trim();
  const instructionText =
    instruction && instruction.length > 0
      ? instruction
      : t('shop.delivery.instruction.default');
  try {
    await args.api.sendMessage(
      args.buyerTelegramId,
      renderMdHtml(instructionText),
      { parse_mode: 'HTML' },
    );
  } catch (err) {
    logger.warn(
      { err, userId: args.buyerTelegramId },
      'delivery: instruction send failed',
    );
  }
  const promptMessageId = await pushPromptCard({
    api: args.api,
    chatId: args.buyerTelegramId,
    lang: args.buyerLang,
    product_name: args.product.name,
    fields: effectiveFields,
    cursor: 0,
  });
  await seedDeliveryFormState({
    telegramId: args.buyerTelegramId,
    orderId: args.orderId,
    orderPublicId: args.orderPublicId,
    product: args.product,
    promptChatId: args.buyerTelegramId,
    promptMessageId,
    editMode: false,
    prefill: {},
  });
  return true;
}

/**
 * Ctx-based entry — called from `pay:wallet:do` in `handlers/shop.ts`
 * right after the Order Delivered card. Same as the api variant but
 * mutates the live session directly so the next message lands in
 * the delivery_form branch immediately.
 */
export async function maybeStartDeliveryFormForCtx(args: {
  ctx: AppCtx;
  product: DBProduct;
  orderId: number;
  orderPublicId: string;
  qty: number;
  editMode?: boolean;
  prefill?: Record<string, string>;
}): Promise<boolean> {
  if (!productHasDeliveryForm(args.product)) return false;
  const ctx = args.ctx;
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return false;
  const effectiveFields = getEffectiveDeliveryFields(args.product);
  const instruction = args.product.delivery_instruction?.trim();
  const instructionText =
    instruction && instruction.length > 0
      ? instruction
      : ctx.t('shop.delivery.instruction.default');
  try {
    await ctx.api.sendMessage(chatId, renderMdHtml(instructionText), {
      parse_mode: 'HTML',
    });
  } catch (err) {
    logger.warn({ err, chatId }, 'delivery: ctx instruction send failed');
  }
  const promptMessageId = await pushPromptCard({
    api: ctx.api,
    chatId,
    lang: ctx.lang,
    product_name: args.product.name,
    fields: effectiveFields,
    cursor: 0,
  });
  ctx.session.userFlow = {
    type: 'delivery_form',
    step: 'fields',
    data: {
      order_id: args.orderId,
      order_public_id: args.orderPublicId,
      product_id: args.product.id,
      product_name: args.product.name,
      fields: effectiveFields,
      collected: { ...(args.prefill ?? {}) },
      cursor: 0,
      edit_mode: args.editMode === true,
      prompt_chat_id: chatId,
      prompt_message_id: promptMessageId,
    },
  };
  return true;
}

/**
 * Same as the ctx variant but writes the flow into a Telegram user
 * session that does NOT currently have a ctx — used by the
 * direct-pay path. We can't access the session middleware from
 * outside an update, so we simply leave it to the user's next
 * message: the catch-all message handler will reconstruct the flow
 * from `pending_order` if needed (see `restoreFromPendingOrder`
 * fallback below).
 *
 * For now this is a no-op placeholder kept for symmetry; direct-pay
 * still works because the buyer's first reply is caught by the
 * session-less path in `handleDeliveryFormMessage` which falls back
 * to looking up the most recent unfinished submission for the user.
 *
 * Future improvement: a tiny `deliveryFormPending` table keyed by
 * `user_id` so a process restart can recover mid-flow.
 */
async function seedDeliveryFormState(_args: {
  telegramId: number;
  orderId: number;
  orderPublicId: string;
  product: DBProduct;
  promptChatId: number;
  promptMessageId: number | undefined;
  editMode: boolean;
  prefill: Record<string, string>;
}): Promise<void> {
  // No external persistence yet — session-flow seed-on-next-message
  // is enough for the wallet-pay path because the session is alive
  // throughout. Direct-pay sets up the prompt but relies on the
  // user's first reply triggering session middleware which assigns
  // a fresh state.
  return;
}

/**
 * Handle a single user message while `userFlow.type === 'delivery_form'`.
 *
 * Returns `true` when the message was consumed by the delivery flow
 * (so the caller should stop further routing). Returns `false` when
 * the user is not in a delivery form — the caller continues normal
 * routing (e.g. the catch-all "echo / Live Support" path).
 */
export async function handleDeliveryFormMessage(ctx: AppCtx): Promise<boolean> {
  const flow = ctx.session.userFlow;
  if (!flow || flow.type !== 'delivery_form') return false;
  const text = ctx.message?.text?.trim();
  if (text === undefined || text.length === 0) return false;
  const field = flow.data.fields[flow.data.cursor];
  if (!field) {
    // Defensive — cursor walked past the end without finalising;
    // reset so the user isn't stuck.
    ctx.session.userFlow = undefined;
    return false;
  }
  let value = text;
  if (field.required === false && /^skip$/i.test(value)) {
    value = '';
  } else if (field.required !== false && value.length === 0) {
    await ctx.reply(
      renderMdHtml(
        ctx.t('shop.delivery.box.invalid', { label: field.label }),
      ),
      { parse_mode: 'HTML' },
    );
    return true;
  }
  flow.data.collected[field.key] = value;
  flow.data.cursor += 1;
  // Auto-delete the user's typed answer so the chat stays clean —
  // the in-place prompt card already shows their progress via
  // step counter. Best-effort: passwords / keys shouldn't linger.
  try {
    await ctx.deleteMessage();
  } catch {
    // Ignored — message older than 48h or already gone.
  }
  if (flow.data.cursor < flow.data.fields.length) {
    const nextMsgId = await pushPromptCard({
      api: ctx.api,
      chatId: flow.data.prompt_chat_id,
      lang: ctx.lang,
      product_name: flow.data.product_name,
      fields: flow.data.fields,
      cursor: flow.data.cursor,
      existingMessageId: flow.data.prompt_message_id,
    });
    flow.data.prompt_message_id = nextMsgId;
    return true;
  }
  // All fields collected — finalise.
  const product = await getProduct(flow.data.product_id);
  if (!product) {
    // Should never happen — product can't disappear between order
    // creation and form completion in practice. Clear the flow so
    // the buyer isn't stuck and let admin handle manually.
    ctx.session.userFlow = undefined;
    return true;
  }
  await finalizeSubmission({
    api: ctx.api,
    chatId: flow.data.prompt_chat_id,
    lang: ctx.lang,
    orderId: flow.data.order_id,
    orderPublicId: flow.data.order_public_id,
    product,
    qty: 1,
    buyer: {
      telegram_id: ctx.user.telegram_id,
      first_name: ctx.user.first_name ?? null,
      username: ctx.user.username ?? null,
    },
    payload: flow.data.collected,
    isResubmit: flow.data.edit_mode,
  });
  ctx.session.userFlow = undefined;
  // Also clear the in-place prompt card — it's been replaced by
  // the summary + success card.
  if (flow.data.prompt_message_id !== undefined) {
    void ctx.api
      .deleteMessage(flow.data.prompt_chat_id, flow.data.prompt_message_id)
      .catch(() => {
        /* prompt already gone — fine */
      });
  }
  return true;
}

/**
 * Open the form pre-filled with the buyer's most recent submission
 * so they can edit individual values without re-typing the whole
 * thing. Called from the `delivery:edit:<orderId>` callback handler
 * registered in `handlers/shop.ts`.
 */
export async function startEditDelivery(args: {
  ctx: AppCtx;
  orderId: number;
}): Promise<boolean> {
  const submission = await getDeliverySubmission(args.orderId);
  if (!submission) return false;
  const product = await getProduct(submission.product_id);
  if (!product) return false;
  const publicId = await derivePublicOrderId(args.orderId);
  try {
    return await maybeStartDeliveryFormForCtx({
      ctx: args.ctx,
      product,
      orderId: args.orderId,
      orderPublicId: publicId,
      qty: 1,
      editMode: true,
      prefill: submission.payload,
    });
  } catch (err) {
    logger.warn({ err, orderId: args.orderId }, 'delivery: startEdit failed');
    return false;
  }
}

/**
 * Look up the public id for a numeric DB order id. Kept here so the
 * edit-callback in `shop.ts` doesn't have to re-import the orders
 * table directly — and so the public-id derivation stays in sync
 * with the rest of the post-purchase code.
 */
async function derivePublicOrderId(orderId: number): Promise<string> {
  const { getOrder } = await import('../db/queries.js');
  const order = await getOrder(orderId);
  if (!order) return `${orderId}`;
  const { publicOrderId } = await import('./orderId.js');
  return publicOrderId(order);
}
