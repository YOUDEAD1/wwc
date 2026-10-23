import { AsyncLocalStorage } from 'node:async_hooks';
import { InlineKeyboard } from 'grammy';
import type { AppCtx } from '../middleware/user.js';
import { registerCopy } from '../services/copyCatalog.js';
import { t as translate } from '../i18n/index.js';
import type { Lang } from '../../config/index.js';
import { addCopyButton } from '../services/copyButtons.js';
import { renderMdHtml } from '../services/premium.js';
const trusted = new AsyncLocalStorage<boolean>(),
  nssImport = new AsyncLocalStorage<boolean>();
export const managedShop = () => process.env.WWC_MANAGED === '1';
export const importingNss = () => nssImport.getStore() === true;
export function freeShop() {
  return (
    managedShop() &&
    !(
      process.env.TENANT_PLAN === 'paid' &&
      Date.parse(process.env.TENANT_PAID_UNTIL ?? '') > Date.now()
    )
  );
}
export function trustedCatalog<T>(work: () => Promise<T>, nss = false) {
  return trusted.run(true, () => nssImport.run(nss, work));
}
export function requirePaidCapability() {
  if (freeShop() && !trusted.getStore())
    throw Object.assign(Error('SUBSCRIPTION_REQUIRED'), { code: 'SUBSCRIPTION_REQUIRED' });
}
export function requireProductPatch(p: Record<string, unknown>) {
  if (!freeShop() || trusted.getStore()) return;
  const allowed = new Set([
    'name',
    'price',
    'description',
    'emoji',
    'emoji_id',
    'is_pinned',
    'stashed_sort_order',
  ]);
  if (Object.keys(p).some((k) => !allowed.has(k))) requirePaidCapability();
}
export function allowedProduct(p: { wwc_source_id?: string | null; note?: string | null } | null) {
  return (
    !freeShop() ||
    Boolean(
      p?.wwc_source_id && p.note?.match(/\[API_PRODUCT_ID:([^\]]+)\]/)?.[1] === p.wwc_source_id,
    )
  );
}
export function subscribeUrl() {
  return `https://t.me/${(process.env.WWC_MANAGER_USERNAME || process.env.NSS_BOT_USERNAME || '').replace(/^@/, '')}?start=wwcsub_${process.env.TENANT_ID ?? ''}`;
}
const copy = {
  en: {
    required:
      'This feature requires a subscription. Free stores sell NSS products; you may edit names, descriptions, prices and margins.',
    subscribe: '💎 Subscribe',
    guide: '📘 Store guide',
    plan: 'Plan',
    free: 'Free · NSS products',
    paid: 'Paid · full store admin',
    back: '⬅️ Admin panel',
    folders: [
      '🚀 Start & store',
      '🛍 Selling & prices',
      '💳 Deposits & orders',
      '🎨 Texts & buttons',
      '🔌 Developer API',
      '💎 Subscription',
    ],
    help: [
      'Customers use /start and you use /admin. WWC runs your store on a separate host; the management bot handles activation and subscriptions.',
      'Free stores import NSS products and stock. You can edit the name, description, selling price and margin. Adding products, accounts, stock or other suppliers requires a subscription. Hidden or unavailable source products cannot be purchased.',
      'Customers fund wallets in your store. NSS purchases use your separate NSS supplier wallet. Revenue is paid sales; known supplier profit subtracts recorded supplier costs before other expenses.',
      'Customize contains folders for start, shopping, deposits, settings and messages. Select the visible text or button, choose its language, preview and save. Product Premium emoji appears on product buttons.',
      'Use /developer or /apikey to open your account API and documentation. The key grants access to your account only. /api remains the store admin source manager.',
      'Open the management bot → My stores, or /stores, for status, members, paid orders and renewal. Free stores have no expiry. Paid expiry returns to free permissions while retaining data. Three business inactivity pauses require the platform owner to unlock the store.',
    ],
  },
  ar: {
    required:
      'هذه الميزة تحتاج اشتراكًا. المجاني يبيع منتجات NSS، ويمكنك تعديل الاسم والوصف والسعر ونسبة الربح.',
    subscribe: '💎 اشتراك',
    guide: '📘 دليل المتجر',
    plan: 'الخطة',
    free: 'مجاني · منتجات NSS',
    paid: 'مدفوع · إدارة كاملة',
    back: '⬅️ لوحة الأدمن',
    folders: [
      '🚀 البداية والمتجر',
      '🛍 البيع والأسعار',
      '💳 الإيداع والطلبات',
      '🎨 النصوص والأزرار',
      '🔌 API للمطورين',
      '💎 الاشتراك',
    ],
    help: [
      'العميل يفتح /start، وأنت تفتح /admin. WWC يشغّل متجرك على استضافة منفصلة، وبوت الإدارة يدير التفعيل والاشتراك.',
      'المجاني يجلب منتجات NSS ومخزونها. يمكنك تعديل الاسم والوصف والسعر ونسبة الربح. إضافة المنتجات والحسابات والمخزون والموردين تحتاج اشتراكًا. المنتج المخفي أو غير المتوفر عند المصدر لا يقبل الشراء.',
      'العميل يشحن محفظته داخل متجرك. شراء منتجات NSS يخصم من رصيدك المستقل عند NSS. الإيراد هو قيمة المبيعات المدفوعة، والربح المعروف يطرح تكلفة المورد المسجلة قبل بقية المصاريف.',
      'التخصيص يحتوي مجلدات البداية والشراء والإيداع والإعدادات والرسائل. اختر النص أو الزر ثم اللغة، وعدّل وعاين واحفظ. إيموجي Premium للمنتج يظهر في زر المنتج.',
      'افتح /developer أو /apikey لواجهة API حسابك وتعليماتها. المفتاح يخص حسابك فقط. /api يبقى مدير اتصال المورد للأدمن.',
      'افتح بوت الإدارة ثم متاجري، أو /stores، للحالة والأعضاء والطلبات والتجديد. المجاني بلا انتهاء. انتهاء المدفوع يعيد صلاحيات المجاني مع بقاء البيانات. بعد ثلاثة إيقافات بسبب الخمول يلزم فتحه من مالك المنصة.',
    ],
  },
  vi: {
    required:
      'Tính năng này cần đăng ký. Cửa hàng miễn phí bán hàng NSS và cho sửa tên, mô tả, giá, lợi nhuận.',
    subscribe: '💎 Đăng ký',
    guide: '📘 Hướng dẫn',
    plan: 'Gói',
    free: 'Miễn phí · hàng NSS',
    paid: 'Trả phí · quản trị đầy đủ',
    back: '⬅️ Quản trị',
    folders: [
      '🚀 Bắt đầu',
      '🛍 Bán hàng và giá',
      '💳 Nạp tiền và đơn',
      '🎨 Văn bản và nút',
      '🔌 API lập trình',
      '💎 Đăng ký',
    ],
    help: [
      'Khách mở /start; chủ mở /admin. WWC chạy cửa hàng riêng; bot quản lý xử lý kích hoạt và đăng ký.',
      'Gói miễn phí nhập sản phẩm NSS. Bạn có thể sửa tên, mô tả, giá và lợi nhuận. Thêm hàng, tài khoản, kho hoặc nhà cung cấp cần trả phí. Hàng ẩn hoặc hết hàng không thể mua.',
      'Khách nạp vào ví cửa hàng. Chi phí NSS trừ từ ví NSS riêng của chủ. Doanh thu là đơn đã trả; lợi nhuận đã biết trừ chi phí nhà cung cấp được ghi, chưa trừ chi phí khác.',
      'Tùy chỉnh có các thư mục bắt đầu, mua, nạp tiền và cài đặt. Chọn văn bản hoặc nút, chọn ngôn ngữ, xem trước rồi lưu. Emoji Premium xuất hiện trên nút sản phẩm.',
      'Mở /developer hoặc /apikey để xem API tài khoản và tài liệu. Khóa chỉ truy cập tài khoản của bạn. /api vẫn quản lý nguồn cho chủ cửa hàng.',
      'Mở bot quản lý → Cửa hàng của tôi hoặc /stores để xem trạng thái, thành viên, đơn và gia hạn. Miễn phí không hết hạn. Hết gói trả phí sẽ về gói miễn phí và giữ dữ liệu. Sau ba lần dừng do không hoạt động, chủ nền tảng phải mở khóa.',
    ],
  },
  zh: {
    required: '此功能需要订阅。免费商店销售 NSS 商品，可修改名称、描述、售价和利润率。',
    subscribe: '💎 订阅',
    guide: '📘 商店指南',
    plan: '套餐',
    free: '免费 · NSS 商品',
    paid: '付费 · 完整管理',
    back: '⬅️ 管理面板',
    folders: [
      '🚀 开始与商店',
      '🛍 销售与价格',
      '💳 充值与订单',
      '🎨 文字与按钮',
      '🔌 开发者 API',
      '💎 订阅',
    ],
    help: [
      '客户使用 /start，您使用 /admin。WWC 在独立主机运行商店，管理机器人负责激活与订阅。',
      '免费套餐从 NSS 获取商品和库存。可修改名称、描述、售价和利润率；添加商品、账户、库存或供应商需要订阅。来源隐藏或缺货时不能购买。',
      '客户充值到本店钱包。NSS 采购使用店主独立的 NSS 钱包。收入是已付款销售额，已知利润减去已记录的供应商成本，尚未扣除其他费用。',
      '自定义按开始、购买、充值、设置和消息分组。选择文字或按钮，再选择语言、预览并保存。商品 Premium 表情会显示在商品按钮中。',
      '使用 /developer 或 /apikey 查看账户 API 和文档。密钥仅访问您的账户。/api 仍是管理员的供应商连接管理。',
      '在 NSS 打开我的商店或 /myshops，查看状态、用户、订单和续订。免费商店无到期日；付费到期后恢复免费权限并保留数据。不活跃暂停三次后需平台所有者解锁。',
    ],
  },
};
for (const key of Object.keys(copy.en)) {
  const value=copy.en[key as keyof typeof copy.en];
  for (const index of (Array.isArray(value)?value.map((_,i)=>i):[null])) {
    const name='platform.'+key+(index===null?'':'.'+index);
    const defaults=Object.fromEntries((['en','ar','vi','zh'] as const).map(lang=>{
      const item=copy[lang][key as keyof typeof copy.en];
      return [lang,index===null?item:(item as string[])[index]];
    })) as Record<Lang,string>;
    registerCopy({key:name,defaults,folder:10,button:['subscribe','guide','back','folders'].includes(key)});
  }
}
export function platformText(lang: string) {
  const selected=(lang in copy?lang:'en') as Lang;
  const base=copy[selected];
  return Object.fromEntries(Object.entries(base).map(([key,value])=>[
    key,Array.isArray(value)?value.map((_,i)=>translate(selected,'platform.'+key+'.'+i)):translate(selected,'platform.'+key)
  ])) as typeof copy.en;
}
export async function showSubscriptionRequired(ctx: AppCtx) {
  const t = platformText(ctx.lang);
  ctx.session.adminFlow = undefined;
  if (ctx.callbackQuery)
    await ctx.answerCallbackQuery({ text: t.required.slice(0, 190), show_alert: true });
  await ctx.reply(renderMdHtml(t.required), {
    parse_mode:'HTML',
    reply_markup: addCopyButton(new InlineKeyboard(),ctx.lang,'platform.subscribe',subscribeUrl(),true),
  });
}
const paidCallbacks =
  /^adm:(?:prod:(?:add|stock:|unl:|items:|delivery:|form:)|cat:(?:add|del)|api:(?:paste|connect|disconnect|supplier|source|link)|supplier|items:)/;
const paidFlows =
  /^(?:add_category|add_product|product_stock|add_product_items|api_connect|supplier_|product_items)/;
export async function platformMiddleware(ctx: AppCtx, next: () => Promise<void>) {
  const data = ctx.callbackQuery?.data ?? '';
  if (data.startsWith('guide:')) {
    const { isAdmin } = await import('../db/queries.js');
    if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
    await ctx.answerCallbackQuery();
    const t = platformText(ctx.lang),
      kb = new InlineKeyboard(),
      index = Number(data.slice(6));
    if (data === 'guide:root') {
      t.folders.forEach((_, i) => addCopyButton(kb,ctx.lang,'platform.folders.'+i,`guide:${i}`).row());
      addCopyButton(kb,ctx.lang,'platform.back','adm:root');
      await ctx.reply(renderMdHtml(`${t.guide}\n${t.plan}: ${freeShop() ? t.free : t.paid}`), {
        parse_mode:'HTML',
        reply_markup: kb,
      });
    } else if (Number.isInteger(index) && t.help[index]) {
      const links = ['adm:store', 'adm:prod', 'adm:pay', 'adm:cust', 'api:open', 'adm:root'];
      addCopyButton(kb,ctx.lang,'platform.folders.'+index,links[index]!).row();
      addCopyButton(kb,ctx.lang,'platform.guide','guide:root');
      if (managedShop())addCopyButton(kb.row(),ctx.lang,'platform.subscribe',subscribeUrl(),true);
      await ctx.reply(renderMdHtml(t.help[index]!), { parse_mode:'HTML',reply_markup: kb });
    }
    return;
  }
  if (!managedShop()) return next();
  if (
    freeShop() &&
    (paidCallbacks.test(data) ||
      (ctx.message?.text && paidFlows.test(ctx.session.adminFlow?.type ?? '')))
  )
    return showSubscriptionRequired(ctx);
  try {
    await next();
    if (ctx.from && !ctx.from.is_bot && ctx.from.id !== Number(process.env.ADMIN_USER_ID)) {
      const { isAdmin } = await import('../db/queries.js');
      if (!(await isAdmin(ctx.from.id))) process.send?.({ type: 'platform_activity' });
    }
  } catch (e) {
    if ((e as { code?: string }).code === 'SUBSCRIPTION_REQUIRED')
      return showSubscriptionRequired(ctx);
    throw e;
  }
}
