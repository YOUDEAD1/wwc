import { Api } from 'grammy';
import { getReferralBalance, getUserByTelegramId } from '../db/queries.js';
import { env } from '../env.js';
import { t } from '../i18n/index.js';
import { renderMdHtml } from './premium.js';

export async function notifyConfirmedReferral(referrerId: number, refereeId: number) {
  const user = await getUserByTelegramId(referrerId);
  if (!user) return;
  const refs = await getReferralBalance(referrerId);
  const api = new Api(env.BOT_TOKEN);
  await api.sendMessage(
    referrerId,
    renderMdHtml(
      t(user.language, 'referral.confirmed_notice', { user: refereeId, count: refs.available }),
    ),
    { parse_mode: 'HTML' },
  );
}
