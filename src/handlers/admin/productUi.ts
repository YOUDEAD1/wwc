import { InlineKeyboard } from 'grammy';
import { colorModeToStyle, type Lang } from '../../../config/index.js';
import type { AppCtx } from '../../middleware/user.js';
import type { DBProduct, DBSupplierProductLink } from '../../types.js';
import {
  getGlobalProfitPercent,
  getProductColor,
  getProductProfitPercent,
} from '../../services/settings.js';

export const PRODUCT_EDITOR_SECTIONS = [
  'main',
  'stock',
  'texts',
  'appearance',
  'pricing',
  'tutorial',
  'delivery',
  'placement',
  'advanced',
] as const;
export type ProductEditorSection = (typeof PRODUCT_EDITOR_SECTIONS)[number];

const en = {
  products: 'Products',
  choose: 'Choose a product to edit its settings.',
  empty: 'No products yet. Add your first product below.',
  add: '➕ Add product',
  prev: '◀️ Previous',
  next: 'Next ▶️',
  refresh: '🔄 Refresh',
  admin: '⬅️ Admin panel',
  page: 'Page {page} / {pages}',
  count: '{count} products · includes hidden products',
  hidden: 'hidden',
  visible: 'visible',
  missing: 'Product no longer exists.',
  edit: 'Edit product',
  select: 'Choose what you want to change.',
  price: 'Price',
  stockLabel: 'Stock',
  status: 'Visibility',
  on: 'ON',
  off: 'OFF',
  backList: '⬅️ Products',
  backProduct: '⬅️ Product settings',
  cancel: '⬅️ Cancel / back',
  name: '🅰️ Name',
  priceEdit: '💰 Price',
  stock: '📦 Stock & accounts',
  texts: '📝 Description, note & warranty',
  appearance: '🎨 Emoji & button color',
  pricing: '💵 Profit, referrals & custom prices',
  tutorial: '📘 Tutorial',
  delivery: '📥 Delivery form',
  placement: '↕️ Order & visibility',
  advanced: '⚙️ Advanced',
  share: '🔗 Share link',
  buyers: '🧾 Buyers',
  quantity: '🔢 Edit stock count',
  unlimited: '♾ Unlimited stock',
  pool: 'Available accounts / items',
  addItems: '➕ Add accounts / items',
  viewItems: '🔎 View accounts / items',
  clearPool: '🧹 Clear items pool',
  syncPool: '🔄 Recount stock from items pool',
  stockHelp:
    'Stock count and the accounts pool are shown separately. Opening this menu does not change either value.',
  desc: '📄 Description',
  clearDesc: '🧹 Clear description',
  note: '📝 Note',
  clearNote: '🧹 Clear note',
  warranty: '⭐ Warranty',
  clearWarranty: '🧹 Clear warranty',
  emoji: '🎬 Edit premium emoji',
  clearEmoji: '🧹 Clear premium emoji',
  color: '🎨 Button color',
  emojiHelp: 'The saved product emoji also appears in its button in the admin product list.',
  profit: '📊 Profit %',
  clearProfit: '🧹 Default profit %',
  referral: '🎁 Referral payment',
  clearReferral: '🧹 Disable referral payment',
  clearPrices: '🧹 Clear custom prices',
  overrides: 'Custom user prices',
  profitLabel: 'Profit margin',
  referralLabel: 'Referrals required',
  default: 'Default',
  manual: 'Manual price',
  tutorialText: '✍️ Tutorial text',
  tutorialFile: '🎞 Tutorial file',
  tutorialUrl: '🔗 Tutorial URL',
  clearFile: '🧹 Clear tutorial file',
  clearTutorial: '🧹 Clear entire tutorial',
  deliveryToggle: '📥 Delivery form',
  instruction: '✏️ Instructions',
  fields: '🗂 Form fields',
  success: '✅ Success message',
  vendor: '🤝 Vendor chat',
  vendorLabel: '🏷 Vendor label',
  clearDelivery: '🧹 Reset delivery form',
  fieldCount: 'Configured fields',
  pin: '📌 Pin position',
  up: '⬆️ Move up',
  down: '⬇️ Move down',
  top: '⏫ Move to top',
  bottom: '⏬ Move to bottom',
  hide: '🙈 Hide product',
  show: '👁 Show product',
  productId: '🆔 Change product ID',
  remove: '🗑 Delete product',
  confirmDelete: 'Delete this product?',
  confirm: '🗑 Confirm deletion',
  deleteHelp: 'This removes the product from the store. Cancel to keep it.',
  enabled: 'Configured',
  unset: 'Not configured',
  saved: '✅ Saved.',
  supplierLink: 'Supplier product',
  syncStock: 'Supplier stock sync',
  autoMoved: 'Moved automatically after running out of stock',
  noSupplier: 'No supplier link',
};
type Label = keyof typeof en;
const zh: Record<Label,string> = {
  "products": "商品",
  "choose": "选择商品以修改设置。",
  "empty": "暂无商品，可点击下方添加。",
  "add": "➕ 添加商品",
  "prev": "◀️ 上一页",
  "next": "下一页 ▶️",
  "refresh": "🔄 刷新",
  "admin": "⬅️ 管理面板",
  "page": "第 {page} / {pages} 页",
  "count": "{count} 件商品 · 包括隐藏商品",
  "hidden": "隐藏",
  "visible": "显示",
  "missing": "商品已不存在。",
  "edit": "编辑商品",
  "select": "选择要修改的项目。",
  "price": "价格",
  "stockLabel": "库存",
  "status": "可见性",
  "on": "开启",
  "off": "关闭",
  "backList": "⬅️ 商品列表",
  "backProduct": "⬅️ 商品设置",
  "cancel": "⬅️ 取消 / 返回",
  "name": "🅰️ 名称",
  "priceEdit": "💰 价格",
  "stock": "📦 库存与账户",
  "texts": "📝 描述、备注与保修",
  "appearance": "🎨 表情与按钮颜色",
  "pricing": "💵 利润、邀请与自定义价格",
  "tutorial": "📘 教程",
  "delivery": "📥 交付表单",
  "placement": "↕️ 排序与可见性",
  "advanced": "⚙️ 高级",
  "share": "🔗 分享链接",
  "buyers": "🧾 买家",
  "quantity": "🔢 修改库存数量",
  "unlimited": "♾ 无限库存",
  "pool": "可用账户 / 项目",
  "addItems": "➕ 添加账户 / 项目",
  "viewItems": "🔎 查看账户 / 项目",
  "clearPool": "🧹 清空项目池",
  "syncPool": "🔄 重新统计库存",
  "stockHelp": "库存数量与账户池分别显示。打开此菜单不会修改数量。",
  "desc": "📄 描述",
  "clearDesc": "🧹 清除描述",
  "note": "📝 备注",
  "clearNote": "🧹 清除备注",
  "warranty": "⭐ 保修",
  "clearWarranty": "🧹 清除保修",
  "emoji": "🎬 编辑 Premium 表情",
  "clearEmoji": "🧹 清除 Premium 表情",
  "color": "🎨 按钮颜色",
  "emojiHelp": "保存的商品表情会显示在管理面板的商品按钮中。",
  "profit": "📊 利润率 %",
  "clearProfit": "🧹 默认利润率",
  "referral": "🎁 邀请额度支付",
  "clearReferral": "🧹 关闭邀请额度支付",
  "clearPrices": "🧹 清除自定义价格",
  "overrides": "用户专属价格",
  "profitLabel": "利润率",
  "referralLabel": "所需邀请额度",
  "default": "默认",
  "manual": "手动价格",
  "tutorialText": "✍️ 教程文字",
  "tutorialFile": "🎞 教程文件",
  "tutorialUrl": "🔗 教程链接",
  "clearFile": "🧹 清除教程文件",
  "clearTutorial": "🧹 清除整个教程",
  "deliveryToggle": "📥 交付表单",
  "instruction": "✏️ 说明",
  "fields": "🗂 表单字段",
  "success": "✅ 成功消息",
  "vendor": "🤝 供应商聊天",
  "vendorLabel": "🏷 供应商标签",
  "clearDelivery": "🧹 重置交付表单",
  "fieldCount": "已配置字段",
  "pin": "📌 固定位置",
  "up": "⬆️ 上移",
  "down": "⬇️ 下移",
  "top": "⏫ 移至顶部",
  "bottom": "⏬ 移至底部",
  "hide": "🙈 隐藏商品",
  "show": "👁 显示商品",
  "productId": "🆔 修改商品编号",
  "remove": "🗑 删除商品",
  "confirmDelete": "删除此商品？",
  "confirm": "🗑 确认删除",
  "deleteHelp": "此操作从商店移除商品，取消可保留。",
  "enabled": "已配置",
  "unset": "未配置",
  "saved": "✅ 已保存。",
  "supplierLink": "供应商商品",
  "syncStock": "供应商库存同步",
  "autoMoved": "缺货后已自动移动",
  "noSupplier": "未关联供应商"
};
const ar: Record<Label, string> = {
  products: 'المنتجات',
  choose: 'اختر المنتج الذي تريد تعديل إعداداته.',
  empty: 'لا توجد منتجات بعد. يمكنك إضافة أول منتج من الزر أدناه.',
  add: '➕ إضافة منتج',
  prev: '◀️ السابق',
  next: 'التالي ▶️',
  refresh: '🔄 تحديث',
  admin: '⬅️ لوحة الأدمن',
  page: 'الصفحة {page} / {pages}',
  count: '{count} منتج · تشمل المنتجات المخفية',
  hidden: 'مخفي',
  visible: 'ظاهر',
  missing: 'هذا المنتج لم يعد موجودًا.',
  edit: 'تعديل المنتج',
  select: 'اختر ما تريد تعديله من الأزرار.',
  price: 'السعر',
  stockLabel: 'المخزون',
  status: 'الظهور',
  on: 'مفعّل',
  off: 'معطّل',
  backList: '⬅️ المنتجات',
  backProduct: '⬅️ إعدادات المنتج',
  cancel: '⬅️ إلغاء ورجوع',
  name: '🅰️ الاسم',
  priceEdit: '💰 السعر',
  stock: '📦 المخزون والحسابات',
  texts: '📝 الوصف والملاحظة والضمان',
  appearance: '🎨 الإيموجي ولون الزر',
  pricing: '💵 الربح والإحالات والأسعار الخاصة',
  tutorial: '📘 شرح الاستخدام',
  delivery: '📥 نموذج التسليم',
  placement: '↕️ الترتيب والإظهار',
  advanced: '⚙️ خيارات متقدمة',
  share: '🔗 رابط المنتج',
  buyers: '🧾 المشترون',
  quantity: '🔢 تعديل عدد المخزون',
  unlimited: '♾ مخزون غير محدود',
  pool: 'الحسابات أو العناصر المتاحة',
  addItems: '➕ إضافة حسابات أو عناصر',
  viewItems: '🔎 عرض الحسابات أو العناصر',
  clearPool: '🧹 مسح مخزون الحسابات',
  syncPool: '🔄 احتساب المخزون من الحسابات',
  stockHelp: 'عدد المخزون ومخزون الحسابات معروضان بشكل منفصل. فتح هذه القائمة لا يغيّر أيًا منهما.',
  desc: '📄 الوصف',
  clearDesc: '🧹 مسح الوصف',
  note: '📝 الملاحظة',
  clearNote: '🧹 مسح الملاحظة',
  warranty: '⭐ الضمان',
  clearWarranty: '🧹 مسح الضمان',
  emoji: '🎬 تعديل إيموجي البريميوم',
  clearEmoji: '🧹 مسح إيموجي البريميوم',
  color: '🎨 لون زر المنتج',
  emojiHelp: 'إيموجي المنتج المحفوظ يظهر أيضًا داخل زر المنتج في قائمة الأدمن.',
  profit: '📊 نسبة الربح',
  clearProfit: '🧹 استخدام الربح الافتراضي',
  referral: '🎁 الدفع بالإحالات',
  clearReferral: '🧹 تعطيل الدفع بالإحالات',
  clearPrices: '🧹 مسح الأسعار الخاصة',
  overrides: 'أسعار المستخدمين الخاصة',
  profitLabel: 'نسبة الربح',
  referralLabel: 'الإحالات المطلوبة',
  default: 'افتراضي',
  manual: 'سعر يدوي',
  tutorialText: '✍️ نص الشرح',
  tutorialFile: '🎞 ملف الشرح',
  tutorialUrl: '🔗 رابط الشرح',
  clearFile: '🧹 مسح ملف الشرح',
  clearTutorial: '🧹 مسح الشرح بالكامل',
  deliveryToggle: '📥 نموذج التسليم',
  instruction: '✏️ التعليمات',
  fields: '🗂 حقول النموذج',
  success: '✅ رسالة النجاح',
  vendor: '🤝 محادثة المورّد',
  vendorLabel: '🏷 اسم المورّد',
  clearDelivery: '🧹 إعادة ضبط نموذج التسليم',
  fieldCount: 'عدد الحقول',
  pin: '📌 تثبيت الترتيب',
  up: '⬆️ تحريك للأعلى',
  down: '⬇️ تحريك للأسفل',
  top: '⏫ أول القائمة',
  bottom: '⏬ آخر القائمة',
  hide: '🙈 إخفاء المنتج',
  show: '👁 إظهار المنتج',
  productId: '🆔 تغيير معرّف المنتج',
  remove: '🗑 حذف المنتج',
  confirmDelete: 'هل تريد حذف هذا المنتج؟',
  confirm: '🗑 تأكيد الحذف',
  deleteHelp: 'سيُحذف المنتج من المتجر. اختر الرجوع للاحتفاظ به.',
  enabled: 'مضبوط',
  unset: 'غير مضبوط',
  saved: '✅ تم الحفظ.',
  supplierLink: 'منتج المورّد',
  syncStock: 'مزامنة مخزون المورّد',
  autoMoved: 'نُقل تلقائيًا بعد نفاد المخزون',
  noSupplier: 'غير مرتبط بمورّد',
};
const vi: Record<Label, string> = {
  products: 'Sản phẩm',
  choose: 'Chọn sản phẩm để chỉnh sửa.',
  empty: 'Chưa có sản phẩm. Thêm sản phẩm đầu tiên bên dưới.',
  add: '➕ Thêm sản phẩm',
  prev: '◀️ Trước',
  next: 'Sau ▶️',
  refresh: '🔄 Làm mới',
  admin: '⬅️ Quản trị',
  page: 'Trang {page} / {pages}',
  count: '{count} sản phẩm · gồm sản phẩm ẩn',
  hidden: 'ẩn',
  visible: 'hiển thị',
  missing: 'Sản phẩm không còn tồn tại.',
  edit: 'Sửa sản phẩm',
  select: 'Chọn mục cần chỉnh sửa.',
  price: 'Giá',
  stockLabel: 'Tồn kho',
  status: 'Hiển thị',
  on: 'BẬT',
  off: 'TẮT',
  backList: '⬅️ Sản phẩm',
  backProduct: '⬅️ Cài đặt sản phẩm',
  cancel: '⬅️ Hủy / quay lại',
  name: '🅰️ Tên',
  priceEdit: '💰 Giá',
  stock: '📦 Kho & tài khoản',
  texts: '📝 Mô tả, ghi chú & bảo hành',
  appearance: '🎨 Emoji & màu nút',
  pricing: '💵 Lợi nhuận, giới thiệu & giá riêng',
  tutorial: '📘 Hướng dẫn',
  delivery: '📥 Biểu mẫu giao hàng',
  placement: '↕️ Thứ tự & hiển thị',
  advanced: '⚙️ Nâng cao',
  share: '🔗 Liên kết sản phẩm',
  buyers: '🧾 Người mua',
  quantity: '🔢 Sửa số lượng tồn kho',
  unlimited: '♾ Kho không giới hạn',
  pool: 'Tài khoản / mặt hàng còn lại',
  addItems: '➕ Thêm tài khoản / mặt hàng',
  viewItems: '🔎 Xem tài khoản / mặt hàng',
  clearPool: '🧹 Xóa kho tài khoản',
  syncPool: '🔄 Đếm lại kho từ tài khoản',
  stockHelp:
    'Số lượng tồn kho và kho tài khoản được hiển thị riêng. Mở menu không thay đổi dữ liệu.',
  desc: '📄 Mô tả',
  clearDesc: '🧹 Xóa mô tả',
  note: '📝 Ghi chú',
  clearNote: '🧹 Xóa ghi chú',
  warranty: '⭐ Bảo hành',
  clearWarranty: '🧹 Xóa bảo hành',
  emoji: '🎬 Sửa emoji Premium',
  clearEmoji: '🧹 Xóa emoji Premium',
  color: '🎨 Màu nút sản phẩm',
  emojiHelp: 'Emoji đã lưu cũng xuất hiện trên nút sản phẩm trong danh sách quản trị.',
  profit: '📊 Lợi nhuận %',
  clearProfit: '🧹 Lợi nhuận mặc định',
  referral: '🎁 Thanh toán giới thiệu',
  clearReferral: '🧹 Tắt thanh toán giới thiệu',
  clearPrices: '🧹 Xóa giá riêng',
  overrides: 'Giá riêng của người dùng',
  profitLabel: 'Lợi nhuận',
  referralLabel: 'Lượt giới thiệu cần',
  default: 'Mặc định',
  manual: 'Giá thủ công',
  tutorialText: '✍️ Nội dung hướng dẫn',
  tutorialFile: '🎞 Tệp hướng dẫn',
  tutorialUrl: '🔗 URL hướng dẫn',
  clearFile: '🧹 Xóa tệp hướng dẫn',
  clearTutorial: '🧹 Xóa toàn bộ hướng dẫn',
  deliveryToggle: '📥 Biểu mẫu giao hàng',
  instruction: '✏️ Chỉ dẫn',
  fields: '🗂 Các trường',
  success: '✅ Thông báo thành công',
  vendor: '🤝 Chat nhà cung cấp',
  vendorLabel: '🏷 Tên nhà cung cấp',
  clearDelivery: '🧹 Đặt lại biểu mẫu',
  fieldCount: 'Số trường',
  pin: '📌 Ghim vị trí',
  up: '⬆️ Lên',
  down: '⬇️ Xuống',
  top: '⏫ Đầu danh sách',
  bottom: '⏬ Cuối danh sách',
  hide: '🙈 Ẩn sản phẩm',
  show: '👁 Hiện sản phẩm',
  productId: '🆔 Đổi ID sản phẩm',
  remove: '🗑 Xóa sản phẩm',
  confirmDelete: 'Xóa sản phẩm này?',
  confirm: '🗑 Xác nhận xóa',
  deleteHelp: 'Sản phẩm sẽ bị xóa khỏi cửa hàng. Hủy để giữ lại.',
  enabled: 'Đã đặt',
  unset: 'Chưa đặt',
  saved: '✅ Đã lưu.',
  supplierLink: 'Sản phẩm nhà cung cấp',
  syncStock: 'Đồng bộ kho nhà cung cấp',
  autoMoved: 'Tự chuyển vị trí khi hết hàng',
  noSupplier: 'Không liên kết nhà cung cấp',
};

export function productUiText(lang: Lang, key: Label, vars: Record<string, string | number> = {}) {
  return (lang === 'ar' ? ar : lang === 'vi' ? vi : lang === 'zh' ? zh : en)[key].replace(
    /\{(\w+)\}/g,
    (token, name: string) => String(vars[name] ?? token),
  );
}

/** Plain names in button labels; custom emojis belong to the Bot API icon slot. */
export function addAdminProductButton(kb: InlineKeyboard, p: DBProduct, page: number, lang: Lang) {
  const name = Array.from(p.name.replace(/\s+/g, ' ').trim()).slice(0, 70).join('');
  const prefix = p.emoji_id ? '' : `${p.emoji || '📦'} `;
  const status = p.active ? '' : ` · ${productUiText(lang, 'hidden')}`;
  kb.text(`${prefix}${name}${status}`, `adm:prod:edit:${p.id}:${page}`);
  if (p.emoji_id) kb.icon(p.emoji_id);
  const style = colorModeToStyle(getProductColor(p.id) ?? 'none');
  if (style) kb.style(style);
  kb.row();
}

export function productEditorBack(ctx: AppCtx, productId: number, page: number) {
  return new InlineKeyboard().text(
    productUiText(ctx.lang, 'cancel'),
    `adm:prod:back:${productId}:${page}`,
  );
}

/** Message inputs need a fresh bot message; only callback cards can be edited. */
export async function renderProductUi(
  ctx: AppCtx,
  view: { text: string; reply_markup: InlineKeyboard; parse_mode: 'HTML' },
) {
  const { text, ...options } = view;
  if (ctx.callbackQuery?.message?.text) await ctx.editMessageText(text, options);
  else await ctx.reply(text, options);
}

const html = (value: string) =>
  value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export function buildProductEditor(
  lang: Lang,
  p: DBProduct,
  page: number,
  section: ProductEditorSection,
  extras: {
    itemsCount?: number;
    overrideCount?: number;
    supplierLink?: Pick<DBSupplierProductLink, 'supplier_product_id' | 'auto_sync_stock'> | null;
  } = {},
) {
  const text = (key: Label) => productUiText(lang, key);
  const state = (value: boolean) => text(value ? 'on' : 'off');
  const configured = (value: unknown) => text(value ? 'enabled' : 'unset');
  const suffix = `${p.id}:${page}`;
  const kb = new InlineKeyboard();
  const action = (label: Label, callback: string, detail = '') => {
    kb.text(text(label) + detail, `adm:prod:${callback}:${suffix}`);
    return kb;
  };
  const folder = (key: Exclude<ProductEditorSection, 'main'>) => action(key, `section:${key}`);
  const lines = [
    `✏️ <b>${text('edit')}</b>`,
    `<b>${html(Array.from(p.name).slice(0, 300).join(''))}</b> · #${p.id}`,
    `${text('price')}: <b>${Number(p.price).toFixed(2)} USDT</b>`,
    `${text('stockLabel')}: <b>${p.unlimited_stock ? '∞' : p.stock}</b> · ${text('status')}: <b>${text(p.active ? 'visible' : 'hidden')}</b>`,
    '',
  ];
  if (section === 'main') {
    lines.push(text('select'));
    action('name', 'name:set');
    action('priceEdit', 'price:set').row();
    folder('stock').row();
    folder('texts').row();
    folder('appearance').row();
    folder('pricing').row();
    folder('tutorial');
    folder('delivery').row();
    folder('placement');
    folder('advanced').row();
    action('share', 'share');
    kb.text(text('buyers'), `adm:ord:p:${p.id}:0`).row();
  } else {
    lines.push(`<b>${text(section)}</b>`);
    switch (section) {
      case 'stock':
        lines.push(`${text('pool')}: <b>${extras.itemsCount ?? 0}</b>`, '', text('stockHelp'));
        action('quantity', 'stock:set').row();
        action('unlimited', 'unl:tog', `: ${state(p.unlimited_stock)}`).row();
        action('addItems', 'items:add').row();
        kb.text(text('viewItems'), `adm:prod:items:view:${suffix}:0`).row();
        action('clearPool', 'items:clr').row();
        action('syncPool', 'items:sync').row();
        break;
      case 'texts':
        lines.push(
          `${text('desc')}: ${configured(p.description)}`,
          `${text('note')}: ${configured(p.note)}`,
          `${text('warranty')}: ${configured(p.warranty)}`,
        );
        action('desc', 'desc:set');
        action('clearDesc', 'desc:clr').row();
        action('note', 'note:settxt');
        action('clearNote', 'note:clr').row();
        action('warranty', 'war:set');
        action('clearWarranty', 'war:clr').row();
        break;
      case 'appearance':
        lines.push(`${text('emoji')}: ${configured(p.emoji_id)}`, '', text('emojiHelp'));
        action('emoji', 'emoji:set').row();
        action('clearEmoji', 'emoji:clr').row();
        action('color', 'color', `: ${getProductColor(p.id) ?? text('default')}`).row();
        break;
      case 'pricing': {
        const profit = getProductProfitPercent(p.id) ?? getGlobalProfitPercent();
        lines.push(
          `${text('profitLabel')}: ${profit === null ? text('manual') : profit + '%'}`,
          `${text('referralLabel')}: ${p.referral_required_count ?? 0}`,
          `${text('overrides')}: ${extras.overrideCount ?? 0}`,
        );
        action('priceEdit', 'price:set').row();
        action('profit', 'profit:set');
        action('clearProfit', 'profit:clr').row();
        action('referral', 'ref:set');
        action('clearReferral', 'ref:clr').row();
        if (extras.overrideCount)
          action('clearPrices', 'cpclr', ` (${extras.overrideCount})`).row();
        break;
      }
      case 'tutorial':
        lines.push(
          `${text('tutorialText')}: ${configured(p.tutorial_text)}`,
          `${text('tutorialFile')}: ${p.tutorial_file_id ? html(p.tutorial_file_type ?? '') : text('unset')}`,
          `${text('tutorialUrl')}: ${p.tutorial_url ? html(p.tutorial_url.slice(0, 500)) : text('unset')}`,
        );
        action('tutorialText', 'tut:settxt').row();
        action('tutorialFile', 'tut:setfile').row();
        action('tutorialUrl', 'tut:seturl').row();
        action('clearFile', 'tut:clrfile').row();
        action('clearTutorial', 'tut:clr').row();
        break;
      case 'delivery':
        lines.push(
          `${text('fieldCount')}: ${p.delivery_fields?.length ?? 0}`,
          `${text('vendor')}: ${p.delivery_vendor_chat_id ?? text('unset')}`,
          `${text('vendorLabel')}: ${p.delivery_vendor_label ? html(p.delivery_vendor_label.slice(0, 300)) : text('unset')}`,
        );
        action('deliveryToggle', 'del:tog', `: ${state(p.delivery_form_enabled)}`).row();
        action('instruction', 'del:instr');
        action('fields', 'del:fields').row();
        action('success', 'del:succ').row();
        action('vendor', 'del:vendor');
        action('vendorLabel', 'del:vlabel').row();
        action('clearDelivery', 'del:clr').row();
        break;
      case 'placement':
        if (p.stashed_sort_order != null) lines.push(text('autoMoved'));
        action(p.active ? 'hide' : 'show', 'tog').row();
        action('pin', 'pin', `: ${state(p.is_pinned)}`).row();
        action('up', 'up');
        action('down', 'dn').row();
        action('top', 'top');
        action('bottom', 'bot').row();
        break;
      case 'advanced':
        if (extras.supplierLink) {
          lines.push(
            `${text('supplierLink')}: <code>${html(extras.supplierLink.supplier_product_id.slice(0, 300))}</code>`,
            `${text('syncStock')}: ${state(extras.supplierLink.auto_sync_stock)}`,
          );
        } else lines.push(text('noSupplier'));
        action('productId', 'id:set').row();
        action('remove', 'del').style('danger').row();
        break;
    }
    kb.text(text('backProduct'), `adm:prod:edit:${suffix}`).row();
  }
  kb.text(text('backList'), `adm:prod:list:${page}`);
  return { text: lines.join('\n'), reply_markup: kb, parse_mode: 'HTML' as const };
}
