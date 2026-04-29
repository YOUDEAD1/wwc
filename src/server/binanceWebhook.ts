/**
 * Inbound HTTP handler for Binance Pay webhook callbacks.
 *
 * On PAY_SUCCESS we look up the corresponding deposit row by
 * `reference == merchantTradeNo`, mark it approved, credit the user's
 * wallet, and DM them. We always respond with the body Binance
 * expects (`{ returnCode: "SUCCESS" }`) for valid signed callbacks
 * even if the deposit is already processed, so Binance stops retrying.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Bot } from 'grammy';
import { logger } from '../logger.js';
import { verifyWebhookSignature } from '../services/binance.js';
import { adjustBalance, findDepositByReference, setDepositStatus } from '../db/queries.js';
import type { AppCtx } from '../middleware/user.js';

const PATH = '/webhook/binance';

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function reply(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Returns true iff this request was a Binance Pay webhook (and we
 * fully handled it, including writing a response). The caller should
 * skip further routing in that case.
 */
export async function handleBinanceWebhook(
  bot: Bot<AppCtx>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== 'POST' || !req.url || !req.url.startsWith(PATH)) return false;

  const timestamp = String(req.headers['binancepay-timestamp'] ?? '');
  const nonce = String(req.headers['binancepay-nonce'] ?? '');
  const signature = String(req.headers['binancepay-signature'] ?? '').toUpperCase();

  const rawBody = await readRawBody(req);

  if (!timestamp || !nonce || !signature) {
    logger.warn('Binance webhook missing auth headers');
    reply(res, 400, { returnCode: 'FAIL', returnMessage: 'missing headers' });
    return true;
  }

  if (!verifyWebhookSignature(timestamp, nonce, rawBody, signature)) {
    logger.warn({ timestamp, nonce }, 'Binance webhook signature mismatch');
    reply(res, 401, { returnCode: 'FAIL', returnMessage: 'bad signature' });
    return true;
  }

  let parsed: { bizType?: string; bizStatus?: string; data?: string };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    reply(res, 400, { returnCode: 'FAIL', returnMessage: 'bad json' });
    return true;
  }

  if (parsed.bizType !== 'PAY') {
    // Acknowledge non-PAY notifications so Binance stops retrying.
    reply(res, 200, { returnCode: 'SUCCESS', returnMessage: null });
    return true;
  }

  let inner: {
    merchantTradeNo?: string;
    totalFee?: string | number;
    currency?: string;
  } = {};
  try {
    inner = parsed.data ? JSON.parse(parsed.data) : {};
  } catch {
    /* keep inner empty */
  }
  const merchantTradeNo = inner.merchantTradeNo;
  if (!merchantTradeNo) {
    reply(res, 200, { returnCode: 'SUCCESS', returnMessage: null });
    return true;
  }

  if (parsed.bizStatus !== 'PAY_SUCCESS') {
    // Other terminal statuses (PAY_CLOSED, etc.) — just ack for now.
    reply(res, 200, { returnCode: 'SUCCESS', returnMessage: null });
    return true;
  }

  const deposit = await findDepositByReference(merchantTradeNo);
  if (!deposit) {
    logger.warn({ merchantTradeNo }, 'Binance webhook for unknown deposit');
    reply(res, 200, { returnCode: 'SUCCESS', returnMessage: null });
    return true;
  }
  if (deposit.status === 'approved') {
    reply(res, 200, { returnCode: 'SUCCESS', returnMessage: null });
    return true;
  }

  await setDepositStatus(deposit.id, 'approved');
  const newBalance = await adjustBalance(deposit.user_id, Number(deposit.amount));
  logger.info(
    { deposit_id: deposit.id, user: deposit.user_id, amount: deposit.amount, newBalance },
    'Binance Pay deposit auto-approved',
  );
  try {
    await bot.api.sendMessage(
      deposit.user_id,
      `✅ *Binance Pay confirmed* — *$${Number(deposit.amount).toFixed(2)}* credited to your wallet.\nNew balance: *$${newBalance}*`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    logger.warn({ err }, 'Could not DM user about Binance Pay credit');
  }

  reply(res, 200, { returnCode: 'SUCCESS', returnMessage: null });
  return true;
}
