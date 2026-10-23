import { Composer, InlineKeyboard } from 'grammy';
import '../../platform/notices.js';
import { copyEntries, copyDefault, requiredFields } from '../../services/copyCatalog.js';
import { adminBody } from '../../platform/adminLocale.js';
import { BUTTON_KEYS, EMOJI, LOCALES, type ColorMode, type Lang } from '../../../config/index.js';
import { getDbScope } from '../../db/db_context.js';
import { deleteSetting, isAdmin, listPaymentMethods, setSetting } from '../../db/queries.js';
import { t } from '../../i18n/index.js';
import type { AppCtx } from '../../middleware/user.js';
import { buttonId, observedButtons } from '../../services/interfaceCustomization.js';
import { networkSnapshot } from '../../services/networkMeter.js';
import { entitiesToHtml, renderMdHtml } from '../../services/premium.js';
import {
  clearButtonIcon,
  clearTextOverride,
  getEmoji,
  getSettingValue,
  getTextOverride,
  refreshSettings,
  setButtonIcon,
  setColor,
  setEmoji,
  setText,
} from '../../services/settings.js';

type Entry = {
  key: string;
  kind: 'text' | 'button' | 'emoji' | 'setting' | 'dynamic' | 'payment';
  label: string;
  folder: number;
  buttonKey?: string;
  methodId?: number;
  paymentDefault?: string;
};
const folders = [
  '🚀 البداية والقائمة الرئيسية',
  '🛍 المنتجات والبحث',
  '🛒 الشراء والتسليم',
  '💳 الإيداع ووسائل الدفع',
  '👤 الحساب والإعدادات',
  '🎁 الإحالات والهدايا',
  '💬 الدعم',
  '🔔 الإشعارات والرسائل',
  '⚙️ المتجر والأداء',
  '🔘 الأزرار الأخرى',
  '📘 دليل المتجر والاشتراك',
  '🏪 تنبيهات تشغيل المتجر',
];
function group(key: string) {
  if (/^(welcome|main|menu)/.test(key)) return 0;
  if (
    /^(buy|pre_order|pay_|confirm_pay|cancel_pay|qty|view_note|using_method|share_product|send_note)/.test(
      key,
    )
  )
    return 2;
  if (/^(shop\.buy|shop\.pay|shop\.referral|order|delivery|qty|invoice)/.test(key)) return 2;
  if (/^(shop|product|category)/.test(key)) return 1;
  if (/(topup|deposit|payment|paymethod|where_txid|where_order_id)/.test(key)) return 3;
  if (/(refer|gift|redeem)/.test(key)) return 5;
  if (/(support|ai_support)/.test(key)) return 6;
  if (/(notify|notification|broadcast|announcement)/.test(key)) return 7;
  if (/(profile|setting|email|currency|region|language|stats)/.test(key)) return 4;
  return 9;
}
function plain(value: string) {
  return (
    value
      .replace(/<[^>]*>|\{[^}]*\}|[*_`]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 48) || 'نص الرسالة'
  );
}
const baseEntries: Entry[] = [];
for (const [buttonKey, key] of Object.entries(BUTTON_KEYS))
  baseEntries.push({
    key,
    kind: 'button',
    buttonKey,
    label: plain(LOCALES.ar[key] ?? LOCALES.en[key] ?? key),
    folder: group(buttonKey.replace(/^pay_/, 'shop.pay.')),
  });
for (const key of Object.keys(LOCALES.en))
  if (!Object.values(BUTTON_KEYS).includes(key as any))
    baseEntries.push({
      key,
      kind: 'text',
      label: plain(LOCALES.ar[key] ?? LOCALES.en[key]!),
      folder: group(key),
    });
for (const key of Object.keys(EMOJI))
  baseEntries.push({ key, kind: 'emoji', label: '😀 ' + emojiLabel(key), folder: group(key) });
for (const [key, label] of [
  ['referral.cost', 'عدد الإحالات مقابل المكافأة'],
  ['referral.amount', 'قيمة مكافأة الإحالات بالدولار'],
  ['referral.limit_per_day', 'حد الإحالات اليومية'],
  ['supplier.sync_minutes', 'الفاصل بين مزامنة الموردين بالدقائق'],
  ['shop_layout_style', 'طريقة عرض المنتجات'],
  ['channel.url', 'رابط القناة'],
  ['admin.contact_url', 'رابط الدعم'],
  ['store.name', 'اسم المتجر'],
])
  baseEntries.push({ key: key!, label: label!, kind: 'setting', folder: 8 });

const scopedEntries = new Map<string, Entry[]>();
function entries() {
  const scope = getDbScope();
  let list = scopedEntries.get(scope);
  if (!list) {
    if (scopedEntries.size >= 200) scopedEntries.delete(scopedEntries.keys().next().value!);
    list = baseEntries.map((e) => ({ ...e }));
    scopedEntries.set(scope, list);
  }
  for (const item of copyEntries()) {
    if (!list.some(e=>e.key===item.key && e.kind!=='dynamic')) list.push({
      key:item.key, kind:item.button?'button':'text',label:plain(item.defaults.ar),folder:item.folder,
      ...(item.button?{buttonKey:'copy.'+item.key}:{})
    });
  }
  const saved=getSettingValue('interface.catalog');
  if (Array.isArray(saved)) for (const item of saved.slice(0,200)) {
    if (item && /^[a-f0-9]{16}$/.test(item.id) && typeof item.label==='string' && !list.some(e=>e.kind==='dynamic'&&e.key===item.id))
      list.push({key:item.id,kind:'dynamic',label:plain(item.label),folder:9});
  }
  return list;
}
function reference(e:Entry,index:number) { return index<baseEntries.length?String(index):'k'+buttonId(e.kind+':'+e.key); }
function entryLabel(e:Entry,lang:Lang) {
  const localized=copyDefault(lang,e.key) ?? ((e.kind==='text'||e.kind==='button')?LOCALES[lang][e.key]:undefined);
  return localized!==undefined?plain(localized):e.label;
}
function entryIndex(ref:string|number) {
  if(typeof ref==='number'||/^\d+$/.test(ref))return Number(ref);
  return entries().findIndex((e,i)=>reference(e,i)===ref);
}
async function persistDynamic(e:Entry,actor:number) {
  const old=getSettingValue('interface.catalog');
  const items=Array.isArray(old)?old.filter(x=>x&&typeof x.id==='string'&&x.id!==e.key):[];
  const next=[...items.slice(-199),{id:e.key,label:e.label}];
  await setSetting('interface.catalog',next,actor);await refreshSettings();
}
export const customizeBot = new Composer<AppCtx>();
customizeBot.use(async (ctx, next) => {
  if(ctx.callbackQuery?.data && !ctx.callbackQuery.data.startsWith('uix:'))ctx.session.customizeFlow=undefined;
  const targeted =
    ctx.callbackQuery?.data?.startsWith('uix:') ||
    ctx.callbackQuery?.data === 'adm:cust' ||
    /^\/customize(?:@\w+)?(?:\s|$)/.test(ctx.message?.text ?? '') ||
    !!ctx.session.customizeFlow;
  if (!targeted) return next();
  if (!ctx.from || !(await isAdmin(ctx.from.id))) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'للأدمن فقط', show_alert: true });
    return;
  }
  return next();
});
async function show(ctx: AppCtx, text: string, kb: InlineKeyboard) {
  text=adminBody(text,ctx.lang);
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => {});
    try {
      await ctx.editMessageText(text, { reply_markup: kb });
      return;
    } catch {
      /* old media message */
    }
  }
  await ctx.reply(text, { reply_markup: kb });
}
async function root(ctx: AppCtx) {
  ctx.session.customizeFlow = undefined;
  ctx.session.customizePick = false;
  ctx.session.adminFlow = undefined;
  ctx.session.userFlow = undefined;
  const kb = new InlineKeyboard();
  folders.forEach((name, i) => kb.text(name, 'uix:folder:' + i + ':0').row());
  kb.text('📦 تعديل منتج بالاسم', 'adm:prod')
    .row()
    .text('🎯 اختيار زر من واجهة البوت', 'uix:pick')
    .row()
    .text('📊 قياس الطلبات والبيانات', 'uix:traffic')
    .row()
    .text('⬅️ لوحة الأدمن', 'adm:root');
  await show(
    ctx,
    'تخصيص المتجر\n\nاختر القسم، ثم النص أو الزر. اختر اللغة قبل التعديل. يمكنك المعاينة والحفظ أو استعادة الافتراضي.',
    kb,
  );
}
customizeBot.command('customize', root);
customizeBot.callbackQuery(['adm:cust', 'uix:root'], root);
customizeBot.callbackQuery('uix:pick', async (ctx) => {
  ctx.session.customizePick = true;
  await show(
    ctx,
    'انتقل الآن إلى أي شاشة في البوت واضغط الزر المطلوب. سيفتح محرره بدل تنفيذ أمره. يمكنك إلغاء الاختيار من هنا.',
    new InlineKeyboard().text('🚀 افتح القائمة', 'uix:pickopen').row().text('إلغاء', 'uix:root'),
  );
});
customizeBot.callbackQuery('uix:pickopen', async (ctx) => {
  await ctx.answerCallbackQuery();
  const { showMainMenu } = await import('../start.js');
  await showMainMenu(ctx);
});
customizeBot.callbackQuery('uix:traffic', async (ctx) => {
  await show(ctx, networkSnapshot(), new InlineKeyboard().text('⬅️ رجوع', 'uix:root'));
});
customizeBot.callbackQuery(/^uix:folder:(\d+):(\d+)$/, async (ctx) => {
  ctx.session.customizeFlow = undefined;
  const folder = Number(ctx.match[1]),
    page = Number(ctx.match[2]);
  if (folder === 3) {
    for (const m of await listPaymentMethods())
      if (!entries().some((e) => e.methodId === m.id))
        entries().push({
          key: 'payment.instructions.' + m.id,
          kind: 'payment',
          label: '📄 تعليمات ' + m.name,
          methodId: m.id,
          paymentDefault: m.instructions,
          folder: 3,
        });
  }
  if (folder === 9)
    for (const [id, label] of observedButtons())
      if (!entries().some((e) => e.kind === 'dynamic' && e.key === id))
        entries().push({ key: id, kind: 'dynamic', label: plain(label), folder: 9 });
  const selected = entries()
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.folder === folder);
  const kb = new InlineKeyboard();
  for (const { e, i } of selected.slice(page * 8, page * 8 + 8))
    kb.text(entryLabel(e,ctx.lang), 'uix:entry:' + reference(e,i) + ':' + ctx.lang).row();
  if (page) kb.text('◀️ السابق', 'uix:folder:' + folder + ':' + (page - 1));
  if ((page + 1) * 8 < selected.length)
    kb.text('التالي ▶️', 'uix:folder:' + folder + ':' + (page + 1));
  kb.row();
  if (folder === 8)
    kb.text('⚙️ إعدادات البوت', 'adm:bot')
      .row()
      .text('🏪 إعدادات المتجر', 'adm:store')
      .row()
      .text('🔌 إعدادات API', 'adm:api')
      .row()
      .text('🔗 Set Channel URL', 'adm:cust:channel')
      .row()
      .text('🔗 Set Referral Channel', 'adm:cust:referral_channel')
      .row()
      .text('🔁 Reload Settings', 'adm:reload')
      .row();
  if (folder === 9)
    kb.text('🎨 Set Color', 'adm:cust:color:pick')
      .row()
      .text('🎯 Custom Color Glyphs', 'adm:cust:colorglyph')
      .row()
      .text('😀 Set Emoji', 'adm:cust:emoji')
      .row()
      .text('🎯 Set Button Icon', 'adm:cust:btnicon')
      .row();
  if (folder === 3) kb.text('💳 إعداد وسائل الدفع', 'adm:pay').row();
  kb.text('⬅️ المجلدات', 'uix:root');
  await show(ctx, folders[folder] + '\nاختر النص أو الزر لتعديله (' + selected.length + ')', kb);
});
async function editor(ctx: AppCtx, ref: number|string, lang: Lang) {
  const index=entryIndex(ref);
  const e = entries()[index];
  if (!e) return root(ctx);
  ctx.session.customizeFlow = undefined;
  const token=reference(e,index);
  const kb = new InlineKeyboard()
    .text('🇸🇦 العربية', 'uix:entry:' + token + ':ar')
    .text('🇺🇸 English', 'uix:entry:' + token + ':en')
    .text('🇻🇳 Việt', 'uix:entry:' + token + ':vi')
    .text('🇨🇳 中文', 'uix:entry:' + token + ':zh')
    .row();
  kb.text(
    e.kind === 'emoji' ? '😀 تغيير الرمز' : '✏️ تعديل النص',
    'uix:edit:' + token + ':' + lang + ':text',
  ).row();
  if (e.kind === 'button' || e.kind === 'dynamic') {
    kb.text('😀 الرمز التعبيري', 'uix:edit:' + token + ':' + lang + ':icon')
      .text('🎨 اللون', 'uix:colors:' + token + ':' + lang)
      .row();
  }
  if (e.kind === 'setting' && e.key === 'shop_layout_style') {
    kb.text('📃 قائمة', 'uix:layout:list').text('🔲 شبكة', 'uix:layout:grid').row();
  }
  kb.text('👁 معاينة', 'uix:preview:' + token + ':' + lang)
    .text('↩️ الافتراضي', 'uix:reset:' + token + ':' + lang)
    .row()
    .text('⬅️ القسم', 'uix:folder:' + e.folder + ':0');
  await show(ctx, entryLabel(e,lang) + '\nاللغة: ' + lang + '\nالقيمة الحالية:\n' + value(e, lang), kb);
}
function value(e: Entry, lang: Lang) {
  if (e.kind === 'emoji') return JSON.stringify(getEmoji(e.key));
  if (e.kind === 'setting')
    return String(getSettingValue('text.' + e.key) ?? getSettingValue(e.key) ?? 'الافتراضي');
  if (e.kind === 'payment') return getTextOverride(e.key,lang) ?? (lang==='ar'?e.paymentDefault:t(lang,'payment.default_instructions')) ?? '';
  if (e.kind === 'dynamic') return getTextOverride('interface.' + e.key, lang) ?? e.label;
  return t(lang, e.key);
}
customizeBot.callbackQuery(/^uix:entry:((?:k[a-f0-9]{16})|\d+):(ar|en|vi|zh)$/, (ctx) =>
  editor(ctx, ctx.match[1]!, ctx.match[2] as Lang),
);
customizeBot.callbackQuery(/^uix:edit:((?:k[a-f0-9]{16})|\d+):(ar|en|vi|zh):(text|icon)$/, async (ctx) => {
  const e = entries()[entryIndex(ctx.match[1]!)];
  if (!e) return root(ctx);
  ctx.session.adminFlow = undefined;
  ctx.session.userFlow = undefined;
  ctx.session.customizeFlow = {
    entry: entryIndex(ctx.match[1]!),
    reference: ctx.match[1]!,
    lang: ctx.match[2] as Lang,
    field: ctx.match[3]!,
  };
  await show(
    ctx,
    'أرسل ' +
      (ctx.match[3] === 'icon' || e.kind === 'emoji'
        ? 'الرمز العادي أو رمز بريميوم واحد'
        : 'النص الجديد') +
      '.\n' +
      (e.kind === 'text' || e.kind === 'button' ? 'احتفظ بالمتغيرات بين { } كما هي.' : '') +
      '\nلن يحفظ قبل الضغط على حفظ.',
    new InlineKeyboard().text('إلغاء', 'uix:entry:' + ctx.match[1] + ':' + ctx.match[2]),
  );
});
customizeBot.on('message:text', async (ctx, next) => {
  const flow = ctx.session.customizeFlow;
  if (!flow) return next();
  if (!(await isAdmin(ctx.user.telegram_id))) return;
  const text = ctx.message.text;
  if (text.startsWith('/')) {
    ctx.session.customizeFlow = undefined;
    return next();
  }
  if (text.length > 3500) {
    await ctx.reply(adminBody('النص طويل؛ الحد 3500 حرف.',ctx.lang));
    return;
  }
  if(!flow.reference && flow.entry>=baseEntries.length)return root(ctx);
  const e = entries()[entryIndex(flow.reference ?? flow.entry)];
  if (!e) return root(ctx);
  if (e.kind === 'setting' && /(cost|amount|limit_per_day|sync_minutes)$/.test(e.key)) {
    const number = Number(text);
    if (
      !Number.isFinite(number) ||
      number < 0 ||
      (e.key.endsWith('cost') && (number < 1 || !Number.isInteger(number))) ||
      (e.key.endsWith('limit_per_day') && !Number.isInteger(number)) ||
      (e.key.endsWith('amount') && (number <= 0 || Math.abs(Math.round(number * 100) - number * 100)>1e-7)) ||
      (e.key.endsWith('sync_minutes') && (number < 1 || number > 1440))
    ) {
      await ctx.reply(adminBody('أرسل قيمة صحيحة وموجبة. فترة المزامنة من 1 إلى 1440 دقيقة.',ctx.lang));
      return;
    }
  }
  const expected = requiredFields(LOCALES.en[e.key] ?? copyDefault('en',e.key) ?? '').filter(
    (k) => !Object.hasOwn(EMOJI, k.slice(1, -1)),
  );
  const supplied = new Set(text.match(/\{\w+\}/g) ?? []);
  if (flow.field==='text' && (e.kind === 'text' || e.kind === 'button') && expected.some((k) => !supplied.has(k))) {
    await ctx.reply(adminBody('احتفظ بهذه المتغيرات: ',ctx.lang)+expected.join(' '));
    return;
  }
  if(flow.field==='text' && copyDefault('en',e.key)!==undefined && [...supplied].some(key=>!expected.includes(key))) {
    await ctx.reply(adminBody('احتفظ بهذه المتغيرات: ',ctx.lang)+expected.join(' '));return;
  }
  if((e.kind==='button'||e.kind==='dynamic') && flow.field==='text' && text.length>64) {
    await ctx.reply(adminBody('اسم الزر طويل؛ الحد 64 حرفًا.',ctx.lang));return;
  }
  if(flow.field==='icon' && !ctx.message.entities?.some(item=>item.type==='custom_emoji') && [...text].length>12) {
    await ctx.reply(adminBody('أرسل رمزًا تعبيريًا واحدًا.',ctx.lang));return;
  }
  const premium=ctx.message.entities?.find((e) => e.type === 'custom_emoji');
  flow.draft = e.kind==='text'||e.kind==='payment'?entitiesToHtml(text,ctx.message.entities):
    premium&&flow.field==='text'?(text.slice(0,premium.offset)+text.slice(premium.offset+premium.length)).trim():text;
  flow.emojiId = premium?.custom_emoji_id;
  await ctx.reply(adminBody('المعاينة قبل الحفظ:\n',ctx.lang)+text, {
    reply_markup: new InlineKeyboard()
      .text('✅ حفظ', 'uix:save')
      .text('إلغاء', 'uix:entry:' + (flow.reference ?? flow.entry) + ':' + flow.lang),
  });
});
customizeBot.callbackQuery('uix:save', async (ctx) => {
  const f = ctx.session.customizeFlow;
  if (!f || f.draft === undefined) return root(ctx);
  if(!f.reference && f.entry>=baseEntries.length)return root(ctx);
  const e = entries()[entryIndex(f.reference ?? f.entry)];
  if (!e) return root(ctx);
  if(e.kind==='dynamic')await persistDynamic(e,ctx.from.id);
  if (f.field === 'icon') {
    if (e.kind === 'dynamic') {
      await setText('interface_icon.' + e.key, f.emojiId ?? '', ctx.from.id);
      await setText('interface_unicode.' + e.key, f.emojiId ? '' : f.draft, ctx.from.id);
    } else await setButtonIcon(e.buttonKey!, f.draft, f.emojiId ?? null, ctx.from.id);
  } else if (e.kind === 'emoji') await setEmoji(e.key, f.draft, f.emojiId, ctx.from.id);
  else if (e.kind === 'setting') {
    await setSetting(
      getSettingValue('text.' + e.key) !== undefined ? 'text.' + e.key : e.key,
      /^(referral\.|supplier\.)/.test(e.key) ? Number(f.draft) : f.draft,
      ctx.from.id,
    );
    await refreshSettings();
  } else
    await setText(
      f.lang + '.' + (e.kind === 'dynamic' ? 'interface.' : '') + e.key,
      f.draft,
      ctx.from.id,
    );
  if(f.field==='text' && f.emojiId && e.kind==='button' && e.buttonKey)await setButtonIcon(e.buttonKey,'✨',f.emojiId,ctx.from.id);
  if(f.field==='text' && f.emojiId && e.kind==='dynamic')await setText('interface_icon.'+e.key,f.emojiId,ctx.from.id);
  await editor(ctx, f.reference ?? f.entry, f.lang);
});
customizeBot.callbackQuery(/^uix:preview:((?:k[a-f0-9]{16})|\d+):(ar|en|vi|zh)$/, async (ctx) => {
  const e = entries()[entryIndex(ctx.match[1]!)];
  if (!e) return root(ctx);
  const lang = ctx.match[2] as Lang;
  await ctx.answerCallbackQuery();
  await ctx
    .reply(
      renderMdHtml(value(e, lang), Object.fromEntries(Object.keys(EMOJI).map((k) => [k, k]))),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(
          '⬅️ المحرر',
          'uix:entry:' + ctx.match[1] + ':' + lang,
        ),
      },
    )
    .catch(() => ctx.reply(value(e, lang)));
});
customizeBot.callbackQuery(/^uix:reset:((?:k[a-f0-9]{16})|\d+):(ar|en|vi|zh)$/, async (ctx) => {
  const e = entries()[entryIndex(ctx.match[1]!)];
  if (!e) return root(ctx);
  const lang = ctx.match[2] as Lang;
  if (e.kind === 'emoji') await deleteSetting('emoji.' + e.key);
  else if (e.kind === 'setting') { await deleteSetting(e.key); await deleteSetting('text.'+e.key); }
  else {
    await clearTextOverride(lang + '.' + (e.kind === 'dynamic' ? 'interface.' : '') + e.key);
    if (e.kind !== 'dynamic') {
      const legacy = getTextOverride(e.key);
      if (legacy !== undefined && getTextOverride(e.key, lang) === legacy)
        await clearTextOverride(e.key);
    }
    if (e.buttonKey) {
      await clearButtonIcon(e.buttonKey);
      await deleteSetting('color.' + e.buttonKey);
    }
    if (e.kind === 'dynamic') {
      await clearTextOverride('interface_icon.' + e.key);
      await clearTextOverride('interface_unicode.' + e.key);
      await clearTextOverride('interface_style.' + e.key);
    }
  }
  await refreshSettings();
  await editor(ctx, ctx.match[1]!, lang);
});
customizeBot.callbackQuery(/^uix:colors:((?:k[a-f0-9]{16})|\d+):(ar|en|vi|zh)$/, async (ctx) => {
  const kb = new InlineKeyboard();
  for (const [mode, label] of Object.entries({
    green: '🟢 أخضر',
    blue: '🔵 أزرق',
    red: '🔴 أحمر',
    yellow: '🟡 أصفر',
    none: '⚪ افتراضي',
  }))
    kb.text(label, 'uix:color:' + ctx.match[1] + ':' + ctx.match[2] + ':' + mode).row();
  kb.text('إلغاء', 'uix:entry:' + ctx.match[1] + ':' + ctx.match[2]);
  await show(ctx, 'اختر لون الزر', kb);
});
customizeBot.callbackQuery(
  /^uix:color:((?:k[a-f0-9]{16})|\d+):(ar|en|vi|zh):(green|blue|red|yellow|none)$/,
  async (ctx) => {
    const e = entries()[entryIndex(ctx.match[1]!)];
    if (!e) return root(ctx);
    if(e.kind==='dynamic')await persistDynamic(e,ctx.from.id);
    if (e.kind === 'dynamic')
      await setText(
        'interface_style.' + e.key,
        { green: 'success', blue: 'primary', red: 'danger', yellow: 'default', none: 'default' }[
          ctx.match[3] as 'green' | 'blue' | 'red' | 'yellow' | 'none'
        ]!,
        ctx.from.id,
      );
    else await setColor(e.buttonKey!, ctx.match[3] as ColorMode, ctx.from.id);
    await editor(ctx, ctx.match[1]!, ctx.match[2] as Lang);
  },
);
customizeBot.callbackQuery(/^uix:layout:(list|grid)$/, async (ctx) => {
  await setSetting('shop_layout_style', ctx.match[1], ctx.from.id);
  await refreshSettings();
  await root(ctx);
});
// Captures the real clicked customer button while the admin is in selection mode.
customizeBot.use(async (ctx, next) => {
  const data = ctx.callbackQuery?.data;
  if (!ctx.session.customizePick || !data || /^uix:/.test(data)) return next();
  if (!(await isAdmin(ctx.user.telegram_id))) return next();
  ctx.session.customizePick = false;
  const registered=data==='guide:root'?'platform.guide':/^guide:\d+$/.test(data)?'platform.folders.'+data.slice(6):undefined;
  if(registered) {
    const index=entries().findIndex(e=>e.key===registered);
    if(index>=0)return editor(ctx,reference(entries()[index]!,index),ctx.lang);
  }
  const id = buttonId(data);
  let index = entries().findIndex((e) => e.kind === 'dynamic' && e.key === id);
  if (index < 0) {
    entries().push({
      key: id,
      kind: 'dynamic',
      label: plain(observedButtons().get(id) ?? 'الزر المحدد'),
      folder: 9,
    });
    index = entries().length - 1;
  }
  await editor(ctx, index, ctx.lang);
});

function emojiLabel(key: string) {
  const words: Record<string, string> = {
    welcome: 'البداية',
    banner: 'العنوان',
    balance: 'الرصيد',
    shop: 'المتجر',
    prod: 'المنتج',
    product: 'المنتج',
    profile: 'الحساب',
    wallet: 'المحفظة',
    pay: 'الدفع',
    topup: 'الإيداع',
    deposits: 'الإيداعات',
    refer: 'الإحالات',
    referral: 'الإحالات',
    orders: 'الطلبات',
    order: 'الطلب',
    support: 'الدعم',
    title: 'العنوان',
    name: 'الاسم',
    total: 'الإجمالي',
    amount: 'المبلغ',
    stock: 'المخزون',
    qty: 'الكمية',
    price: 'السعر',
    back: 'رجوع',
    next: 'التالي',
    notify: 'الإشعارات',
    stats: 'الإحصاءات',
    email: 'البريد',
    delivery: 'التسليم',
    tutorial: 'الشرح',
    invoice: 'الفاتورة',
    copy: 'نسخ',
    link: 'الرابط',
    help: 'المساعدة',
    success: 'النجاح',
    failed: 'الفشل',
    button: 'الزر',
    field: 'الحقل',
    deposit: 'الإيداع',
    send: 'إرسال',
    cancel: 'إلغاء',
    confirm: 'تأكيد',
    l: 'يسار',
    r: 'يمين',
  };
  return key
    .split('_')
    .map((part) => words[part] ?? part)
    .join(' ');
}
