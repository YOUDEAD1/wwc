/**
 * Admin command surface. Every command is gated by the `adminOnly`
 * middleware. All commands accept positional whitespace-separated
 * arguments. Use `/admin` to see the cheat-sheet.
 */
import { Composer } from 'grammy';
import { adminOnly } from '../../middleware/adminOnly.js';
import {
  addCategory,
  addPaymentMethod,
  addProduct,
  listUsersForAnnouncement,
} from '../../db/queries.js';
import * as cache from '../../services/cache.js';
import { setColor, setEmoji, setText, refreshSettings } from '../../services/settings.js';
import { renderPremium } from '../../services/premium.js';
import type { ColorMode } from '../../../config/index.js';
import { COLOR_PREFIX } from '../../../config/index.js';
import type { AppCtx } from '../../middleware/user.js';
import { logger } from '../../logger.js';

const HELP = `
🛠 *Admin Commands*

Texts / Buttons / Emojis:
\`/settext <key> <text...>\`     — override any i18n string
\`/setbutton <key> <text...>\`   — override a button label
\`/setcolor <key> <mode>\`       — mode: blue|green|red|yellow|none
\`/setemoji <key> <unicode> [custom_emoji_id]\` — premium emoji map

Catalog:
\`/addcategory <name> [emoji]\`
\`/addproduct <category_id> <price> <stock> <name...>\`
\`/addpayment <name> | <instructions> | <min_amount>\`

Communications:
\`/announce <text...>\`           — broadcast (premium emojis OK)
\`/clearcache\`                   — purge runtime caches
\`/reload\`                       — reload settings from DB

Tip: \`<key>\` for /settext is any i18n key — see config/locales/en.ts.
`;

export const adminBot = new Composer<AppCtx>();
adminBot.use(adminOnly);

adminBot.command('admin', async (ctx) => {
  await ctx.reply(HELP, { parse_mode: 'Markdown' });
});

adminBot.command('settext', async (ctx) => {
  const [, key, ...rest] = (ctx.message?.text ?? '').split(/\s+/);
  const value = rest.join(' ');
  if (!key || !value) {
    await ctx.reply(ctx.t('admin.bad_args', { usage: '/settext <key> <text...>' }));
    return;
  }
  await setText(key, value, ctx.from!.id);
  await ctx.reply(ctx.t('admin.text.set', { key }), { parse_mode: 'Markdown' });
});

adminBot.command('setbutton', async (ctx) => {
  const [, key, ...rest] = (ctx.message?.text ?? '').split(/\s+/);
  const value = rest.join(' ');
  if (!key || !value) {
    await ctx.reply(ctx.t('admin.bad_args', { usage: '/setbutton <key> <text...>' }));
    return;
  }
  // i18n keys for buttons start with btn.* — accept either form
  const i18nKey = key.startsWith('btn.') ? key : `btn.${key}`;
  await setText(i18nKey, value, ctx.from!.id);
  await ctx.reply(ctx.t('admin.text.set', { key: i18nKey }), { parse_mode: 'Markdown' });
});

adminBot.command('setcolor', async (ctx) => {
  const [, key, modeRaw] = (ctx.message?.text ?? '').split(/\s+/);
  if (!key || !modeRaw) {
    await ctx.reply(
      ctx.t('admin.bad_args', { usage: '/setcolor <key> <blue|green|red|yellow|none>' }),
    );
    return;
  }
  const mode = modeRaw as ColorMode;
  if (!(mode in COLOR_PREFIX)) {
    await ctx.reply(`Unknown color "${modeRaw}". Allowed: ${Object.keys(COLOR_PREFIX).join(', ')}`);
    return;
  }
  await setColor(key, mode, ctx.from!.id);
  await ctx.reply(ctx.t('admin.color.set', { key, color: mode }), { parse_mode: 'Markdown' });
});

adminBot.command('setemoji', async (ctx) => {
  const [, key, unicode, customId] = (ctx.message?.text ?? '').split(/\s+/);
  if (!key || !unicode) {
    await ctx.reply(
      ctx.t('admin.bad_args', { usage: '/setemoji <key> <unicode> [custom_emoji_id]' }),
    );
    return;
  }
  await setEmoji(key, unicode, customId, ctx.from!.id);
  await ctx.reply(ctx.t('admin.emoji.set', { key }), { parse_mode: 'Markdown' });
});

adminBot.command('addcategory', async (ctx) => {
  const args = (ctx.message?.text ?? '').split(/\s+/).slice(1);
  if (args.length === 0) {
    await ctx.reply(ctx.t('admin.bad_args', { usage: '/addcategory <name> [emoji]' }));
    return;
  }
  // Last token is treated as emoji if it's a single grapheme that's not alpha-numeric
  const last = args[args.length - 1]!;
  let emoji: string | undefined;
  let name: string;
  if (args.length > 1 && /^\p{Extended_Pictographic}/u.test(last)) {
    emoji = last;
    name = args.slice(0, -1).join(' ');
  } else {
    name = args.join(' ');
  }
  const cat = await addCategory(name, emoji);
  cache.del('cats');
  await ctx.reply(ctx.t('admin.category.added', { name: cat.name, id: cat.id }), {
    parse_mode: 'Markdown',
  });
});

adminBot.command('addproduct', async (ctx) => {
  const m = (ctx.message?.text ?? '').match(
    /^\/addproduct\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/,
  );
  if (!m) {
    await ctx.reply(
      ctx.t('admin.bad_args', { usage: '/addproduct <category_id> <price> <stock> <name...>' }),
    );
    return;
  }
  const product = await addProduct({
    category_id: Number(m[1]),
    price: Number(m[2]),
    stock: Number(m[3]),
    name: m[4]!,
  });
  cache.del('cats');
  await ctx.reply(ctx.t('admin.product.added', { name: product.name, id: product.id }), {
    parse_mode: 'Markdown',
  });
});

adminBot.command('addpayment', async (ctx) => {
  // Format: /addpayment Name | Instructions text | 1
  const raw = (ctx.message?.text ?? '').replace(/^\/addpayment\s+/, '');
  const parts = raw.split('|').map((s) => s.trim());
  if (parts.length < 2) {
    await ctx.reply(
      ctx.t('admin.bad_args', { usage: '/addpayment Name | Instructions | min_amount' }),
    );
    return;
  }
  const [name, instructions, minStr] = parts;
  const m = await addPaymentMethod({
    name: name!,
    instructions: instructions!,
    min_amount: minStr ? Number(minStr) : 1,
  });
  await ctx.reply(ctx.t('admin.payment.added', { name: m.name, id: m.id }), {
    parse_mode: 'Markdown',
  });
});

adminBot.command('announce', async (ctx) => {
  const body = (ctx.message?.text ?? '').replace(/^\/announce\s*/, '');
  if (!body) {
    await ctx.reply(ctx.t('admin.bad_args', { usage: '/announce <text...>' }));
    return;
  }
  const recipients = await listUsersForAnnouncement();
  await ctx.reply(`📣 Broadcasting to ${recipients.length} user(s)…`);
  let ok = 0;
  let fail = 0;
  for (const r of recipients) {
    try {
      const { text, entities } = renderPremium(body);
      await ctx.api.sendMessage(r.telegram_id, text, {
        entities: entities.length ? entities : undefined,
        parse_mode: entities.length ? undefined : 'Markdown',
      });
      ok++;
    } catch (err) {
      fail++;
      logger.warn({ err, user: r.telegram_id }, 'announce send failed');
    }
  }
  await ctx.reply(`Done. Delivered: ${ok}, failed: ${fail}.`);
});

adminBot.command('clearcache', async (ctx) => {
  cache.clearAll();
  await ctx.reply(ctx.t('admin.cache.cleared'));
});

adminBot.command('reload', async (ctx) => {
  await refreshSettings();
  cache.clearAll();
  await ctx.reply('🔁 Settings reloaded.');
});
