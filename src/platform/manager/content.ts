import type { Registry } from '../repository.js';
import { PlatformError } from '../security.js';
import { walletPrice } from '../pricing.js';
export const languages = ['en', 'ar', 'vi', 'zh'] as const;
export type Language = (typeof languages)[number];
export const languageNames: Record<Language, string> = {
  en: 'English',
  ar: 'العربية',
  vi: 'Tiếng Việt',
  zh: '中文',
};
export type CopyEntry = {
  key: string;
  folder: number;
  button: boolean;
  values: Record<Language, string>;
};
export const catalog: CopyEntry[] = [];
function c(
  key: string,
  folder: number,
  button: boolean,
  en: string,
  ar: string,
  vi: string,
  zh: string,
) {
  const clean = (s: string) =>
    button ? s : s.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[\da-fA-F]+);)/g, '&amp;');
  catalog.push({
    key,
    folder,
    button,
    values: { en: clean(en), ar: clean(ar), vi: clean(vi), zh: clean(zh) },
  });
}
c(
  'welcome',
  0,
  false,
  '<b>✦ Your store. Your brand.</b>\n\nWelcome, {name}. Create a connected store, shape its identity and follow its growth from one place.\n\nStart free. Upgrade when you need more.',
  '<b>✦ متجرك. هويتك. انطلاقتك.</b>\n\nأهلًا {name}. افتح متجرًا متصلًا بمنتجات NSS، خصّص هويته وتابع نموه من مكان واحد.\n\nابدأ مجانًا وطوّر متجرك عندما تحتاج.',
  '<b>✦ Cửa hàng của bạn. Thương hiệu của bạn.</b>\n\nChào {name}. Tạo cửa hàng kết nối, cá nhân hóa thương hiệu và theo dõi tăng trưởng tại một nơi.\n\nBắt đầu miễn phí, nâng cấp khi cần.',
  '<b>✦ 你的商店，你的品牌。</b>\n\n欢迎，{name}。创建互联商店，打造品牌，在此查看增长。\n\n免费起步，按需升级。',
);
c(
  'choose_language',
  0,
  false,
  'Choose your language. You can change it in Settings.',
  'اختر لغتك. تستطيع تغييرها لاحقًا من الإعدادات.',
  'Chọn ngôn ngữ. Bạn có thể đổi trong Cài đặt.',
  '请选择语言，之后可在设置中更改。',
);
c('create', 0, true, '🚀 Create my store', '🚀 افتح متجري', '🚀 Tạo cửa hàng', '🚀 创建商店');
c('shops', 0, true, '🏪 My stores', '🏪 متاجري', '🏪 Cửa hàng của tôi', '🏪 我的商店');
c(
  'plans',
  0,
  true,
  '💎 Plans & subscription',
  '💎 الخطط والاشتراك',
  '💎 Gói & đăng ký',
  '💎 套餐与订阅',
);
c('guide', 0, true, '📘 Store guide', '📘 دليل المتجر', '📘 Hướng dẫn', '📘 商店指南');
c('settings', 0, true, '⚙️ Settings', '⚙️ الإعدادات', '⚙️ Cài đặt', '⚙️ 设置');
c('home', 0, true, '⌂ Home', '⌂ الرئيسية', '⌂ Trang chủ', '⌂ 首页');
c('back', 0, true, '‹ Back', '‹ رجوع', '‹ Quay lại', '‹ 返回');
c('cancel', 0, true, '✕ Cancel', '✕ إلغاء', '✕ Hủy', '✕ 取消');
c('confirm', 0, true, '✓ Confirm', '✓ تأكيد', '✓ Xác nhận', '✓ 确认');
c('refresh', 0, true, '↻ Refresh', '↻ تحديث', '↻ Làm mới', '↻ 刷新');
c('next', 0, true, 'Next ›', 'التالي ›', 'Tiếp ›', '下一页 ›');
c('previous', 0, true, '‹ Previous', '‹ السابق', '‹ Trước', '‹ 上一页');
c('language', 0, true, '🌐 Language', '🌐 اللغة', '🌐 Ngôn ngữ', '🌐 语言');
c(
  'settings_body',
  0,
  false,
  '<b>⚙️ Your settings</b>\nLanguage: {language}\n\nYour stores and NSS balance stay linked to your Telegram account.',
  '<b>⚙️ إعداداتك</b>\nاللغة: {language}\n\nمتاجرك ورصيد NSS مرتبطان بحسابك في تيليجرام.',
  '<b>⚙️ Cài đặt của bạn</b>\nNgôn ngữ: {language}\n\nCửa hàng và số dư NSS gắn với tài khoản Telegram của bạn.',
  '<b>⚙️ 你的设置</b>\n语言：{language}\n\n商店及 NSS 余额关联此 Telegram 账户。',
);
c(
  'private',
  0,
  false,
  'Open this bot in a private chat to manage your store.',
  'افتح البوت في الخاص لإدارة متجرك.',
  'Mở chat riêng để quản lý cửa hàng.',
  '请在私聊中管理商店。',
);
c('saved', 0, false, '✓ Saved.', '✓ تم الحفظ.', '✓ Đã lưu.', '✓ 已保存。');
c(
  'cancelled',
  0,
  false,
  'Cancelled. Your existing stores and data are unchanged.',
  'تم الإلغاء. متاجرك وبياناتك الحالية محفوظة.',
  'Đã hủy. Cửa hàng và dữ liệu hiện có được giữ nguyên.',
  '已取消，现有商店及数据保留。',
);
c(
  'expired',
  0,
  false,
  'This step expired. Please start again from the menu.',
  'انتهت مهلة هذه الخطوة. ابدأ من القائمة من جديد.',
  'Bước này đã hết hạn. Hãy bắt đầu lại từ menu.',
  '此步骤已过期，请从菜单重新开始。',
);
c(
  'error',
  0,
  false,
  'Unable to complete this step now. Try again shortly.\nReference: <code>{code}</code>',
  'تعذر إكمال هذه الخطوة الآن. حاول بعد قليل.\nالمرجع: <code>{code}</code>',
  'Chưa thể hoàn tất. Hãy thử lại sau.\nMã: <code>{code}</code>',
  '暂时无法完成，请稍后重试。\n编号：<code>{code}</code>',
);
c(
  'forbidden',
  0,
  false,
  'You do not have permission to do that.',
  'ليس لديك صلاحية لهذا الإجراء.',
  'Bạn không có quyền thực hiện.',
  '你无权执行此操作。',
);
c(
  'limited',
  0,
  false,
  'Please wait a moment before trying again.',
  'انتظر قليلًا قبل المحاولة مجددًا.',
  'Vui lòng chờ một chút rồi thử lại.',
  '请稍等片刻再试。',
);
c(
  'account_required',
  1,
  false,
  '<b>Connect your NSS account</b>\nOpen NSS and send /start once, then return here. Your existing balance will be used for subscription payments.',
  '<b>اربط حسابك في NSS</b>\nافتح NSS وأرسل /start مرة واحدة ثم ارجع هنا. سيُستخدم رصيدك الحالي عند شراء الاشتراك.',
  '<b>Kết nối NSS</b>\nMở NSS và gửi /start một lần rồi quay lại. Đăng ký dùng số dư NSS hiện có.',
  '<b>关联 NSS 账户</b>\n打开 NSS 并发送一次 /start，然后返回。订阅将使用现有 NSS 余额。',
);
c('nss', 1, true, '💰 Open NSS wallet', '💰 افتح محفظة NSS', '💰 Mở ví NSS', '💰 打开 NSS 钱包');
c(
  'setup_intro',
  1,
  false,
  '<b>🚀 Launch your store</b>\n\n1 · Bot token from @BotFather\n2 · Your separate Supabase project URL\n3 · Its service_role or sb_secret key\n4 · Run the SQL file, open your new bot, then activate\n\nKeys are encrypted and removed from the setup draft after 20 minutes. The free plan sells NSS products; no local products or stock.',
  '<b>🚀 افتح متجرك</b>\n\n1 · توكن بوت جديد من @BotFather\n2 · رابط مشروع Supabase مستقل لمتجرك\n3 · مفتاح service_role أو sb_secret الخاص به\n4 · شغّل ملف SQL وافتح بوتك الجديد ثم فعّله\n\nتُشفّر المفاتيح وتنتهي مسودة الإعداد بعد 20 دقيقة. المجاني يبيع منتجات NSS، دون إضافة منتجات أو مخزون محلي.',
  '<b>🚀 Khởi chạy cửa hàng</b>\n\n1 · Token bot mới từ @BotFather\n2 · URL dự án Supabase riêng\n3 · Khóa service_role hoặc sb_secret\n4 · Chạy SQL, mở bot mới rồi kích hoạt\n\nKhóa được mã hóa, bản nháp hết hạn sau 20 phút. Gói miễn phí bán sản phẩm NSS, không thêm hàng cục bộ.',
  '<b>🚀 开通商店</b>\n\n1 · 从 @BotFather 获取新机器人令牌\n2 · 独立 Supabase 项目网址\n3 · 该项目的 service_role 或 sb_secret 密钥\n4 · 执行 SQL，打开新机器人，然后激活\n\n密钥加密保存，设置草稿 20 分钟后失效。免费套餐销售 NSS 商品，不可添加本地商品或库存。',
);
c('begin', 1, true, 'Let’s begin →', 'ابدأ الآن ←', 'Bắt đầu →', '开始 →');
c(
  'token_prompt',
  1,
  false,
  '<b>Step 1 / 3 · Bot token</b>\nSend the token for your new store bot. Use a separate bot, not NSS or this manager.',
  '<b>الخطوة 1 / 3 · توكن البوت</b>\nأرسل توكن بوت المتجر الجديد. استخدم بوتًا مستقلًا عن NSS وبوت الإدارة.',
  '<b>Bước 1 / 3 · Token bot</b>\nGửi token bot cửa hàng mới, khác NSS và bot quản lý này.',
  '<b>步骤 1 / 3 · 机器人令牌</b>\n发送新商店机器人的令牌，不能使用 NSS 或本管理机器人。',
);
c(
  'url_prompt',
  1,
  false,
  '<b>Step 2 / 3 · Supabase URL</b>\nSend your separate store project URL, for example https://project.supabase.co',
  '<b>الخطوة 2 / 3 · رابط Supabase</b>\nأرسل رابط مشروع المتجر المستقل، مثل https://project.supabase.co',
  '<b>Bước 2 / 3 · URL Supabase</b>\nGửi URL dự án cửa hàng riêng, ví dụ https://project.supabase.co',
  '<b>步骤 2 / 3 · Supabase 网址</b>\n发送独立商店项目网址，例如 https://project.supabase.co',
);
c(
  'key_prompt',
  1,
  false,
  '<b>Step 3 / 3 · Server key</b>\nSend service_role or sb_secret, not an anon/publishable key. It stays encrypted.',
  '<b>الخطوة 3 / 3 · مفتاح الخادم</b>\nأرسل service_role أو sb_secret، وليس anon أو publishable. يُحفظ مشفرًا.',
  '<b>Bước 3 / 3 · Khóa máy chủ</b>\nGửi service_role hoặc sb_secret, không dùng anon/publishable. Khóa được mã hóa.',
  '<b>步骤 3 / 3 · 服务端密钥</b>\n发送 service_role 或 sb_secret，不使用 anon 或 publishable 密钥。密钥将加密保存。',
);
c(
  'sql_ready',
  1,
  false,
  '<b>✓ Store registered: @{bot}</b>\n\n1 · Run the attached file in your store’s Supabase SQL Editor.\n2 · Open @{bot} and send /start.\n3 · Return and press Check & activate.\n\nYour store is not activated until these checks succeed.',
  '<b>✓ تم تسجيل المتجر: @{bot}</b>\n\n1 · شغّل الملف المرفق في SQL Editor بمشروع Supabase الخاص بالمتجر.\n2 · افتح @{bot} وأرسل /start.\n3 · ارجع واضغط فحص وتفعيل.\n\nيُفعّل المتجر بعد نجاح هذه الفحوصات.',
  '<b>✓ Đã đăng ký: @{bot}</b>\n\n1 · Chạy tệp đính kèm trong SQL Editor của dự án cửa hàng.\n2 · Mở @{bot} và gửi /start.\n3 · Quay lại, nhấn Kiểm tra & kích hoạt.\n\nCửa hàng chỉ kích hoạt khi kiểm tra thành công.',
  '<b>✓ 商店已登记：@{bot}</b>\n\n1 · 在商店项目的 SQL Editor 中执行附件。\n2 · 打开 @{bot}，发送 /start。\n3 · 返回并点击检查并激活。\n\n通过检查后才会激活。',
);
c(
  'activate',
  1,
  true,
  '✅ Check & activate',
  '✅ فحص وتفعيل',
  '✅ Kiểm tra & kích hoạt',
  '✅ 检查并激活',
);
c('sql', 1, true, '📄 Download SQL', '📄 تنزيل SQL', '📄 Tải SQL', '📄 下载 SQL');
c('open_bot', 1, true, '↗ Open store', '↗ افتح المتجر', '↗ Mở cửa hàng', '↗ 打开商店');
c(
  'active_done',
  1,
  false,
  '<b>✓ Store activated</b>\nOpen your store and use /admin to customize products, buttons and content. Your dashboard is ready below.',
  '<b>✓ تم تفعيل المتجر</b>\nافتح متجرك واستخدم /admin لتخصيص المنتجات والأزرار والمحتوى. لوحة متجرك جاهزة بالأسفل.',
  '<b>✓ Đã kích hoạt</b>\nMở cửa hàng và dùng /admin để tùy chỉnh sản phẩm, nút và nội dung. Bảng điều khiển ở bên dưới.',
  '<b>✓ 商店已激活</b>\n打开商店并使用 /admin 定制商品、按钮和内容。控制面板已就绪。',
);
c(
  'queued',
  1,
  false,
  'Your setup is ready. Hosting is at its active-store limit; activation is queued automatically.',
  'إعداد متجرك جاهز. الاستضافة وصلت لسعة المتاجر النشطة؛ أُضيف متجرك لطابور التفعيل تلقائيًا.',
  'Thiết lập đã sẵn sàng. Máy chủ đã đủ cửa hàng hoạt động; cửa hàng được xếp hàng kích hoạt.',
  '设置已就绪。当前活动商店已达托管上限，已自动加入激活队列。',
);
c(
  'no_shops',
  2,
  false,
  '<b>Your next idea starts here.</b>\nYou do not have a store yet. Create one to see its dashboard.',
  '<b>خطوتك الأولى تبدأ هنا.</b>\nلا يوجد متجر لحسابك بعد. افتح متجرك لتظهر لوحة إدارته.',
  '<b>Ý tưởng tiếp theo bắt đầu tại đây.</b>\nBạn chưa có cửa hàng. Tạo một cửa hàng để xem bảng điều khiển.',
  '<b>下一段旅程从这里开始。</b>\n你还没有商店，创建后即可查看控制面板。',
);
c(
  'list_title',
  2,
  false,
  '<b>🏪 Your stores</b>\nChoose a store to view its dashboard.',
  '<b>🏪 متاجرك</b>\nاختر المتجر لفتح لوحة إدارته.',
  '<b>🏪 Cửa hàng của bạn</b>\nChọn cửa hàng để xem bảng điều khiển.',
  '<b>🏪 你的商店</b>\n选择商店查看控制面板。',
);
c(
  'store_item',
  2,
  true,
  '{status} @{bot} · {plan}',
  '{status} @{bot} · {plan}',
  '{status} @{bot} · {plan}',
  '{status} @{bot} · {plan}',
);
c(
  'dashboard',
  2,
  false,
  '<b>✦ @{bot} · Dashboard</b>\n{status} · {plan}\n\n👥 Members: <b>{users}</b>\n🧾 Paid orders: <b>{orders}</b>\n💵 Sales: <b>${revenue}</b>\n📈 Known supplier profit: <b>${profit}</b>\n\nRuntime: {runtime}\nSubscription until: {until}\nInactivity strikes: {strikes}/3\nLast customer: {customer}\nLast purchase: {purchase}\n\n{note}',
  '<b>✦ @{bot} · لوحة المتجر</b>\n{status} · {plan}\n\n👥 الأعضاء: <b>{users}</b>\n🧾 الطلبات المدفوعة: <b>{orders}</b>\n💵 المبيعات: <b>${revenue}</b>\n📈 ربح المورد المعروف: <b>${profit}</b>\n\nالتشغيل: {runtime}\nنهاية الاشتراك: {until}\nمخالفات الخمول: {strikes}/3\nآخر عميل: {customer}\nآخر شراء: {purchase}\n\n{note}',
  '<b>✦ @{bot} · Bảng điều khiển</b>\n{status} · {plan}\n\n👥 Thành viên: <b>{users}</b>\n🧾 Đơn đã trả: <b>{orders}</b>\n💵 Doanh số: <b>${revenue}</b>\n📈 Lãi nhà cung cấp đã biết: <b>${profit}</b>\n\nHoạt động: {runtime}\nHết đăng ký: {until}\nLần ngừng do không hoạt động: {strikes}/3\nKhách gần nhất: {customer}\nMua gần nhất: {purchase}\n\n{note}',
  '<b>✦ @{bot} · 控制面板</b>\n{status} · {plan}\n\n👥 用户：<b>{users}</b>\n🧾 已付款订单：<b>{orders}</b>\n💵 销售额：<b>${revenue}</b>\n📈 已知供应商利润：<b>${profit}</b>\n\n运行：{runtime}\n订阅截止：{until}\n闲置停用次数：{strikes}/3\n最近客户：{customer}\n最近购买：{purchase}\n\n{note}',
);
c(
  'metrics_note',
  2,
  false,
  'Figures include completed paid orders. Supplier profit covers only orders with recorded supplier cost. Checks are cached for 60 seconds.',
  'الأرقام للطلبات المدفوعة. ربح المورد يشمل فقط الطلبات التي سُجّلت تكلفتها. يُحفظ الفحص مؤقتًا 60 ثانية.',
  'Số liệu của đơn đã thanh toán. Lãi chỉ gồm đơn có ghi nhận giá vốn nhà cung cấp. Kiểm tra được lưu 60 giây.',
  '统计已付款订单。供应商利润仅涵盖已记录成本的订单。检查结果缓存 60 秒。',
);
c(
  'stats_unavailable',
  2,
  false,
  'Statistics could not be verified now. Try Refresh later.',
  'تعذر التحقق من الإحصاءات الآن. جرّب التحديث لاحقًا.',
  'Chưa xác minh được số liệu. Hãy làm mới sau.',
  '暂时无法核实统计数据，请稍后刷新。',
);
c('ready', 2, false, '🟢 Ready', '🟢 جاهز', '🟢 Sẵn sàng', '🟢 就绪');
c(
  'cold',
  2,
  false,
  '🟢 Connected; wakes on demand',
  '🟢 متصل؛ يعمل عند الطلب',
  '🟢 Đã kết nối, chạy theo yêu cầu',
  '🟢 已连接，按需启动',
);
c('unverified', 2, false, '⚪ Unverified', '⚪ غير متحقق', '⚪ Chưa xác minh', '⚪ 未核实');
c(
  'not_running',
  2,
  false,
  '🔴 Check connection',
  '🔴 افحص الاتصال',
  '🔴 Kiểm tra kết nối',
  '🔴 请检查连接',
);
c('none', 2, false, '—', '—', '—', '—');
c('state_active', 2, false, '🟢 Active', '🟢 نشط', '🟢 Hoạt động', '🟢 活动');
c('state_setup', 2, false, '🟡 Setup', '🟡 قيد الإعداد', '🟡 Thiết lập', '🟡 设置中');
c('state_idle', 2, false, '⏸ Paused', '⏸ متوقف', '⏸ Tạm dừng', '⏸ 已暂停');
c(
  'state_locked',
  2,
  false,
  '🔒 Owner unlock required',
  '🔒 يحتاج فتح المالك',
  '🔒 Cần chủ nền tảng mở',
  '🔒 需要平台所有者解锁',
);
c('state_suspended', 2, false, '🔴 Suspended', '🔴 موقوف إداريًا', '🔴 Đình chỉ', '🔴 已停用');
c('free', 2, false, 'Free', 'مجاني', 'Miễn phí', '免费');
c('paid', 2, false, 'Paid', 'مدفوع', 'Trả phí', '付费');
c('pause', 2, true, '⏸ Pause store', '⏸ إيقاف المتجر', '⏸ Tạm dừng', '⏸ 暂停商店');
c('resume', 2, true, '▶ Resume store', '▶ تشغيل المتجر', '▶ Tiếp tục', '▶ 恢复商店');
c(
  'credentials',
  2,
  true,
  '🔑 Replace connection',
  '🔑 تحديث بيانات الربط',
  '🔑 Đổi kết nối',
  '🔑 更新连接',
);
c(
  'confirm_action',
  2,
  false,
  'Confirm: {action}\nStore: @{bot}',
  'تأكيد الإجراء: {action}\nالمتجر: @{bot}',
  'Xác nhận: {action}\nCửa hàng: @{bot}',
  '确认操作：{action}\n商店：@{bot}',
);
c(
  'plans_body',
  3,
  false,
  '<b>💎 Build at your own pace</b>\n\n<b>Free</b> · NSS products only. Set your margin, names, descriptions and branding. No local products, stock or other suppliers. No subscription expiry.\n\n<b>Paid</b> · Full store admin, including your own products and stock. Platform super admin stays with the platform owner.\n\nPrice: {price} USD / {days} days\nPayment: your existing NSS wallet. Expiry returns the store to Free and preserves its data.',
  '<b>💎 طوّر متجرك على راحتك</b>\n\n<b>مجاني</b> · منتجات NSS فقط. عدّل الربح والأسماء والأوصاف وهوية متجرك. لا إضافة منتجات أو مخزون محلي أو موردين آخرين. دون انتهاء اشتراك.\n\n<b>مدفوع</b> · إدارة متجر كاملة، مع منتجاتك ومخزونك. السوبر أدمن يبقى لمالك المنصة.\n\nالسعر: {price} دولار / {days} يومًا\nالدفع من محفظة NSS الحالية. انتهاء الاشتراك يرجع المتجر للمجاني ويحفظ البيانات.',
  '<b>💎 Phát triển theo nhịp của bạn</b>\n\n<b>Miễn phí</b> · Chỉ sản phẩm NSS. Đổi lãi, tên, mô tả và thương hiệu; không thêm hàng, tồn kho cục bộ hay nhà cung cấp khác. Không hết hạn đăng ký.\n\n<b>Trả phí</b> · Đầy đủ quản trị cửa hàng, gồm hàng và tồn kho riêng. Siêu quản trị thuộc chủ nền tảng.\n\nGiá: {price} USD / {days} ngày\nThanh toán bằng ví NSS. Hết hạn trở về Miễn phí, dữ liệu được giữ.',
  '<b>💎 按自己的节奏成长</b>\n\n<b>免费</b> · 仅销售 NSS 商品。可修改利润、名称、描述及品牌，不可添加本地商品、库存或其他供应商。无订阅到期限制。\n\n<b>付费</b> · 完整商店管理员功能，包括自有商品与库存。超级管理员仅限平台所有者。\n\n价格：{price} 美元 / {days} 天\n使用现有 NSS 钱包支付。到期降为免费，保留数据。',
);
c(
  'subscribe',
  3,
  true,
  '💎 Subscribe / renew',
  '💎 اشتراك / تجديد',
  '💎 Đăng ký / gia hạn',
  '💎 订阅 / 续费',
);
c('price_disabled', 3, false, 'Not set yet', 'غير محدد بعد', 'Chưa đặt', '尚未设置');
c(
  'quote',
  3,
  false,
  '<b>💎 NSS wallet checkout</b>\n\nStore: @{bot}\nPeriod: {days} days\nTotal: <b>${amount}</b>\nYour NSS balance: <b>${balance}</b>\nExpires: {expires}\n\nOnly Confirm payment authorizes a debit.',
  '<b>💎 الدفع من محفظة NSS</b>\n\nالمتجر: @{bot}\nالمدة: {days} يومًا\nالإجمالي: <b>${amount}</b>\nرصيد NSS: <b>${balance}</b>\nصلاحية العرض: {expires}\n\nزر تأكيد الدفع وحده يوافق على الخصم.',
  '<b>💎 Thanh toán ví NSS</b>\n\nCửa hàng: @{bot}\nThời hạn: {days} ngày\nTổng: <b>${amount}</b>\nSố dư NSS: <b>${balance}</b>\nHết hạn: {expires}\n\nChỉ Xác nhận thanh toán mới cho phép trừ tiền.',
  '<b>💎 NSS 钱包结算</b>\n\n商店：@{bot}\n期限：{days} 天\n总额：<b>${amount}</b>\nNSS 余额：<b>${balance}</b>\n有效期至：{expires}\n\n仅确认付款才会授权扣款。',
);
c(
  'pay',
  3,
  true,
  '✅ Confirm payment · ${amount}',
  '✅ تأكيد الدفع · ${amount}',
  '✅ Xác nhận trả · ${amount}',
  '✅ 确认付款 · ${amount}',
);
c(
  'payment_pending',
  3,
  false,
  '<b>Payment is being reconciled</b>\nUse Refresh for the same payment. Do not open a second checkout.\nReference: {reference}',
  '<b>جارٍ تثبيت حالة الدفع</b>\nاستخدم تحديث لنفس العملية. لا تفتح عملية دفع ثانية.\nالمرجع: {reference}',
  '<b>Đang đối soát thanh toán</b>\nLàm mới cùng giao dịch, không tạo thanh toán thứ hai.\nMã: {reference}',
  '<b>正在核对付款</b>\n请刷新本笔付款，勿创建第二笔。\n编号：{reference}',
);
c(
  'receipt',
  3,
  false,
  '<b>✓ Subscription updated</b>\n\nCharged: ${amount}\nNSS balance after payment: ${balance}\nReference: <code>{reference}</code>',
  '<b>✓ تم تحديث الاشتراك</b>\n\nالمبلغ: ${amount}\nرصيد NSS بعد الدفع: ${balance}\nالمرجع: <code>{reference}</code>',
  '<b>✓ Đã cập nhật đăng ký</b>\n\nĐã trừ: ${amount}\nSố dư NSS sau trả: ${balance}\nMã: <code>{reference}</code>',
  '<b>✓ 订阅已更新</b>\n\n扣款：${amount}\n扣款后 NSS 余额：${balance}\n编号：<code>{reference}</code>',
);
c(
  'insufficient',
  3,
  false,
  'Your NSS balance is insufficient. Add funds in NSS, then confirm this checkout.',
  'رصيد NSS لا يكفي. اشحن محفظتك في NSS ثم أكّد هذه العملية.',
  'Số dư NSS không đủ. Nạp ví NSS rồi xác nhận giao dịch này.',
  'NSS 余额不足，请先充值再确认本笔付款。',
);
c(
  'payment_expired',
  3,
  false,
  'This checkout is cancelled or expired. No new payment was authorized.',
  'هذه العملية ملغاة أو منتهية. لم يُصرّح بدفع جديد.',
  'Giao dịch đã hủy hoặc hết hạn. Không cho phép thanh toán mới.',
  '本次结算已取消或过期，未授权新扣款。',
);
c(
  'guide_body',
  4,
  false,
  '<b>📘 Your store playbook</b>\nChoose a topic. Every guide is editable by the platform owner.',
  '<b>📘 دليل متجرك</b>\nاختر الموضوع. يستطيع مالك المنصة تعديل كل التعليمات.',
  '<b>📘 Sổ tay cửa hàng</b>\nChọn chủ đề. Chủ nền tảng có thể sửa mọi hướng dẫn.',
  '<b>📘 商店指南</b>\n请选择主题，平台所有者可编辑全部说明。',
);
c(
  'guide_setup',
  4,
  true,
  '🚀 Setup & activation',
  '🚀 الإعداد والتفعيل',
  '🚀 Thiết lập & kích hoạt',
  '🚀 设置与激活',
);
c(
  'guide_selling',
  4,
  true,
  '🛍 Products & profit',
  '🛍 المنتجات والأرباح',
  '🛍 Sản phẩm & lợi nhuận',
  '🛍 商品与利润',
);
c(
  'guide_design',
  4,
  true,
  '🎨 Buttons & design',
  '🎨 الأزرار والتصميم',
  '🎨 Nút & giao diện',
  '🎨 按钮与设计',
);
c(
  'guide_wallet',
  4,
  true,
  '💳 Wallet & subscription',
  '💳 المحفظة والاشتراك',
  '💳 Ví & đăng ký',
  '💳 钱包与订阅',
);
c(
  'guide_idle',
  4,
  true,
  '🌙 Inactivity & resources',
  '🌙 الخمول والموارد',
  '🌙 Không hoạt động & tài nguyên',
  '🌙 闲置与资源',
);
c(
  'selling_help',
  4,
  false,
  '<b>Products & profit</b>\nYour store connects to NSS with your account’s API key. Open your store → /admin → Products to select a product and edit its name, description or price. Set a margin before selling. Free stores cannot add local products or stock. Availability follows NSS; do not treat a cached stock count as a reservation.',
  '<b>المنتجات والأرباح</b>\nيتصل متجرك بـNSS بمفتاح API لحسابك. افتح متجرك ← /admin ← المنتجات، واختر المنتج وعدّل اسمه أو وصفه أو سعره. حدّد هامش الربح قبل البيع. المجاني لا يضيف منتجات أو مخزونًا محليًا. التوفر يتبع NSS؛ عرض المخزون المؤقت ليس حجزًا.',
  '<b>Sản phẩm & lợi nhuận</b>\nCửa hàng nối NSS bằng khóa API của tài khoản bạn. Mở cửa hàng → /admin → Sản phẩm để sửa tên, mô tả hoặc giá. Đặt biên lợi nhuận trước khi bán. Miễn phí không thêm hàng hay tồn kho riêng. Tồn kho theo NSS; số lưu tạm không phải đặt chỗ.',
  '<b>商品与利润</b>\n商店使用你账户的 API 密钥连接 NSS。打开商店 → /admin → 商品，选择商品修改名称、描述或价格。销售前请设置利润。免费商店不可添加自有商品或库存。库存跟随 NSS，缓存数量不代表预留。',
);
c(
  'design_help',
  4,
  false,
  '<b>Make it yours</b>\nOpen your store → /admin → Customize. Folders organize Start, Products, Purchase, Deposit, Account and Guides. Select a button or text to edit it, choose its language, Premium emoji and color, then preview. Keep every {placeholder} shown by the editor.',
  '<b>خصّص هويتك</b>\nافتح متجرك ← /admin ← التخصيص. ستجد مجلدات البداية والمنتجات والشراء والإيداع والحساب والدليل. اختر زرًا أو نصًا وعدّل لغته وإيموجي بريميوم ولونه ثم عاينه. احتفظ بكل {placeholder} يعرضه المحرر.',
  '<b>Tạo dấu ấn riêng</b>\nMở cửa hàng → /admin → Tùy chỉnh. Các thư mục gồm Bắt đầu, Sản phẩm, Mua, Nạp, Tài khoản và Hướng dẫn. Chọn nút hoặc văn bản, sửa ngôn ngữ, emoji Premium, màu rồi xem trước. Giữ mọi {placeholder} trình sửa hiển thị.',
  '<b>打造品牌</b>\n打开商店 → /admin → 定制。按开始、商品、购买、充值、账户与指南分组。选择按钮或文本，修改语言、Premium 表情、颜色并预览。保留编辑器显示的全部 {placeholder}。',
);
c(
  'wallet_help',
  4,
  false,
  '<b>One wallet for your subscription</b>\nSubscribe here using your existing NSS balance. You see price and duration before confirmation. Repeated confirmations reuse one receipt. If activation is delayed, payment stays pending and is reconciled automatically. Deposit methods and store customer balances stay in their existing bots.',
  '<b>محفظتك الحالية للاشتراك</b>\nاشترك هنا برصيد NSS الحالي. يظهر السعر والمدة قبل التأكيد. تكرار التأكيد يستخدم نفس الإيصال. إذا تأخر التفعيل تبقى العملية قيد المعالجة وتُستكمل تلقائيًا. الإيداع وأرصدة عملاء المتجر تبقى في بوتاتها الحالية.',
  '<b>Ví hiện có cho đăng ký</b>\nĐăng ký tại đây bằng số dư NSS. Xem giá và thời hạn trước khi xác nhận. Xác nhận lặp dùng một biên nhận. Nếu kích hoạt chậm, thanh toán được đối soát tự động. Nạp tiền và số dư khách hàng vẫn ở các bot hiện có.',
  '<b>使用现有钱包订阅</b>\n在此用 NSS 余额订阅，确认前查看价格及期限。重复确认使用同一收据。激活延迟时付款保留待处理状态，自动核对。充值方式及商店客户余额仍在各自机器人中。',
);
c(
  'idle_help',
  4,
  false,
  '<b>Resource-friendly hosting</b>\nStores wake on demand instead of running one process each. A short queue handles busy periods. Customer activity keeps a store active; admin visits and health checks do not. Warning at 48 hours, pause at 72 hours. After 3 inactivity pauses, the platform owner must unlock it. A completed sale resets strikes.',
  '<b>استضافة قليلة الاستهلاك</b>\nتعمل المتاجر عند الطلب دون عملية دائمة لكل متجر، مع طابور قصير وقت الضغط. دخول العملاء أو الشراء نشاط؛ زيارة الأدمن والفحص ليسا نشاطًا. تنبيه بعد 48 ساعة وتوقّف بعد 72 ساعة. بعد 3 مرات خمول يحتاج فتح المالك. الشراء المكتمل يصفر المخالفات.',
  '<b>Tiết kiệm tài nguyên</b>\nCửa hàng chạy theo yêu cầu thay vì mỗi cửa hàng một tiến trình. Hàng chờ ngắn xử lý giờ bận. Hoạt động khách giữ cửa hàng mở; quản trị và kiểm tra không tính. Cảnh báo 48 giờ, dừng 72 giờ. Sau 3 lần cần chủ nền tảng mở; bán thành công đặt lại số lần.',
  '<b>节约资源的托管</b>\n商店按需启动，共享进程，繁忙时短暂排队。客户访问与购买计为活动，管理访问及健康检查不计。48 小时提醒，72 小时暂停。3 次闲置暂停后需平台所有者解锁，完成销售重置次数。',
);
c(
  'super',
  5,
  true,
  '🛡 Platform control',
  '🛡 إدارة المنصة',
  '🛡 Quản trị nền tảng',
  '🛡 平台管理',
);
c(
  'console',
  5,
  true,
  '🎨 Content console',
  '🎨 كونسول التخصيص',
  '🎨 Bảng tùy chỉnh',
  '🎨 内容控制台',
);
c('all_shops', 5, true, '🏘 All stores', '🏘 جميع المتاجر', '🏘 Tất cả cửa hàng', '🏘 全部商店');
c(
  'super_body',
  5,
  false,
  '<b>🛡 Platform overview</b>\nRegistered: {total} · Active: {active}\nFree: {free} · Paid: {paid}\nPaused / locked / setup: {other}\n\nWarm processes: {workers}/{worker_limit}\nQueued requests: {queue}\nActive-store limit: {limit}\n\nStore details load only when opened to reduce database traffic.',
  '<b>🛡 نظرة على المنصة</b>\nالمسجلة: {total} · النشطة: {active}\nالمجانية: {free} · المدفوعة: {paid}\nمتوقفة / مقفلة / إعداد: {other}\n\nالعمليات الدافئة: {workers}/{worker_limit}\nالطلبات المنتظرة: {queue}\nسعة المتاجر النشطة: {limit}\n\nتُجلب تفاصيل المتجر عند فتحه لتقليل طلبات قاعدة البيانات.',
  '<b>🛡 Tổng quan nền tảng</b>\nĐã đăng ký: {total} · Hoạt động: {active}\nMiễn phí: {free} · Trả phí: {paid}\nDừng / khóa / thiết lập: {other}\n\nTiến trình ấm: {workers}/{worker_limit}\nYêu cầu chờ: {queue}\nGiới hạn hoạt động: {limit}\n\nChỉ tải chi tiết khi mở để giảm lưu lượng cơ sở dữ liệu.',
  '<b>🛡 平台总览</b>\n登记：{total} · 活动：{active}\n免费：{free} · 付费：{paid}\n暂停 / 锁定 / 设置：{other}\n\n热进程：{workers}/{worker_limit}\n排队请求：{queue}\n活动商店上限：{limit}\n\n仅打开商店时加载详情以减少数据库流量。',
);
c('unlock', 5, true, '🔓 Owner unlock', '🔓 فتح من المالك', '🔓 Chủ nền tảng mở', '🔓 所有者解锁');
c('grant', 5, true, '🎁 Grant subscription', '🎁 منح اشتراك', '🎁 Tặng đăng ký', '🎁 赠送订阅');
c(
  'console_body',
  5,
  false,
  '<b>🎨 Content console</b>\nChoose a folder, then a message or button. Edit each language separately. Live texts use the existing master settings table.',
  '<b>🎨 كونسول التخصيص</b>\nاختر المجلد ثم الرسالة أو الزر. عدّل كل لغة بصورة مستقلة. تُحفظ النصوص في جدول إعدادات المنصة الحالي.',
  '<b>🎨 Bảng tùy chỉnh</b>\nChọn thư mục rồi chọn văn bản hoặc nút. Sửa riêng từng ngôn ngữ. Dùng bảng cài đặt nền tảng hiện có.',
  '<b>🎨 内容控制台</b>\n选择文件夹，再选择消息或按钮。每种语言单独编辑，使用现有平台设置表保存。',
);
c(
  'folder_0',
  5,
  true,
  '🏠 Start & navigation',
  '🏠 البداية والتنقل',
  '🏠 Bắt đầu & điều hướng',
  '🏠 开始与导航',
);
c('folder_1', 5, true, '🚀 Store setup', '🚀 فتح المتجر', '🚀 Thiết lập cửa hàng', '🚀 商店设置');
c(
  'folder_2',
  5,
  true,
  '📊 Store dashboard',
  '📊 لوحة المتجر',
  '📊 Bảng điều khiển',
  '📊 商店控制面板',
);
c('folder_3', 5, true, '💎 Plans & wallet', '💎 الخطط والمحفظة', '💎 Gói & ví', '💎 套餐与钱包');
c(
  'folder_4',
  5,
  true,
  '📘 Help & instructions',
  '📘 المساعدة والتعليمات',
  '📘 Trợ giúp & hướng dẫn',
  '📘 帮助与说明',
);
c(
  'folder_5',
  5,
  true,
  '🛡 Admin & console',
  '🛡 الأدمن والكونسول',
  '🛡 Quản trị & tùy chỉnh',
  '🛡 管理与控制台',
);
c('edit', 5, true, '✏️ Edit text', '✏️ تعديل النص', '✏️ Sửa văn bản', '✏️ 编辑文本');
c('emoji', 5, true, '✨ Button emoji', '✨ إيموجي الزر', '✨ Emoji nút', '✨ 按钮表情');
c('color', 5, true, '🎨 Button color', '🎨 لون الزر', '🎨 Màu nút', '🎨 按钮颜色');
c(
  'reset',
  5,
  true,
  '↩ Restore default',
  '↩ استرجاع الافتراضي',
  '↩ Khôi phục mặc định',
  '↩ 恢复默认',
);
c('preview', 5, true, '👁 Preview', '👁 معاينة', '👁 Xem trước', '👁 预览');
c(
  'entry_body',
  5,
  false,
  '<b>{title}</b>\nEditing language: {language}\n\n{value}\n\nRequired placeholders: <code>{fields}</code>',
  '<b>{title}</b>\nلغة التعديل: {language}\n\n{value}\n\nالمتغيرات المطلوبة: <code>{fields}</code>',
  '<b>{title}</b>\nNgôn ngữ sửa: {language}\n\n{value}\n\nBiến bắt buộc: <code>{fields}</code>',
  '<b>{title}</b>\n编辑语言：{language}\n\n{value}\n\n必需占位符：<code>{fields}</code>',
);
c(
  'edit_prompt',
  5,
  false,
  'Send the new text with Telegram formatting and Premium emojis. Keep these placeholders: <code>{fields}</code>. You will preview it before saving.',
  'أرسل النص الجديد بتنسيق تيليجرام وإيموجي بريميوم. احتفظ بالمتغيرات: <code>{fields}</code>. ستعاينه قبل الحفظ.',
  'Gửi nội dung mới với định dạng Telegram và emoji Premium. Giữ biến: <code>{fields}</code>. Bạn sẽ xem trước trước khi lưu.',
  '发送新文本，可使用 Telegram 格式及 Premium 表情。保留占位符：<code>{fields}</code>。保存前可预览。',
);
c(
  'emoji_prompt',
  5,
  false,
  'Send a normal emoji or a Premium custom emoji. Send 0 to remove the extra button icon.',
  'أرسل إيموجي عاديًا أو إيموجي بريميوم. أرسل 0 لحذف الأيقونة الإضافية للزر.',
  'Gửi emoji thường hoặc Premium. Gửi 0 để bỏ biểu tượng thêm.',
  '发送普通或 Premium 表情。发送 0 删除附加图标。',
);
c(
  'save_preview',
  5,
  false,
  '<b>Preview · {language}</b>\n\n{value}\n\nSave this version?',
  '<b>معاينة · {language}</b>\n\n{value}\n\nهل تريد حفظ هذا التعديل؟',
  '<b>Xem trước · {language}</b>\n\n{value}\n\nLưu phiên bản này?',
  '<b>预览 · {language}</b>\n\n{value}\n\n保存此版本？',
);
c(
  'invalid_copy',
  5,
  false,
  'This content is invalid. Check formatting, length and required placeholders, then send it again.',
  'المحتوى غير صالح. راجع التنسيق والطول والمتغيرات المطلوبة ثم أرسله مجددًا.',
  'Nội dung chưa hợp lệ. Kiểm tra định dạng, độ dài và biến bắt buộc rồi gửi lại.',
  '内容无效，请检查格式、长度及必需占位符后重发。',
);
c('blue', 5, true, '🔵 Blue', '🔵 أزرق', '🔵 Xanh dương', '🔵 蓝色');
c('green', 5, true, '🟢 Green', '🟢 أخضر', '🟢 Xanh lá', '🟢 绿色');
c('red', 5, true, '🔴 Red', '🔴 أحمر', '🔴 Đỏ', '🔴 红色');
c('default_color', 5, true, '⚪ Default', '⚪ افتراضي', '⚪ Mặc định', '⚪ 默认');
c(
  'plan_config',
  5,
  true,
  '⚙️ Subscription settings',
  '⚙️ إعدادات الاشتراك',
  '⚙️ Cài đặt đăng ký',
  '⚙️ 订阅设置',
);
c(
  'plan_config_body',
  5,
  false,
  '<b>Subscription settings</b>\nPrice: {price} USD\nDuration: {days} days\n\nNew quotes use these settings. Existing confirmed quotes keep their recorded price.',
  '<b>إعدادات الاشتراك</b>\nالسعر: {price} دولار\nالمدة: {days} يومًا\n\nتُطبّق على العروض الجديدة. العروض المسجلة تحتفظ بسعرها.',
  '<b>Cài đặt đăng ký</b>\nGiá: {price} USD\nThời hạn: {days} ngày\n\nBáo giá mới dùng cài đặt này. Báo giá đã ghi giữ giá đã lưu.',
  '<b>订阅设置</b>\n价格：{price} 美元\n期限：{days} 天\n\n适用于新报价，已登记报价保留原价格。',
);
c('edit_price', 5, true, '💵 Set price', '💵 تحديد السعر', '💵 Đặt giá', '💵 设置价格');
c('edit_days', 5, true, '🗓 Set duration', '🗓 تحديد المدة', '🗓 Đặt thời hạn', '🗓 设置期限');
c(
  'policy_prompt',
  5,
  false,
  'Send the new value. Price: USD up to 6 decimal places, or 0 to disable new checkouts. Duration: 1–365 days.',
  'أرسل القيمة الجديدة. السعر بالدولار حتى 6 خانات عشرية، أو 0 لتعطيل عروض الدفع الجديدة. المدة من 1 إلى 365 يومًا.',
  'Gửi giá trị mới. Giá USD tối đa 6 chữ số thập phân, hoặc 0 để tắt thanh toán mới. Thời hạn 1–365 ngày.',
  '发送新值。美元价格最多 6 位小数，0 关闭新结算。期限 1–365 天。',
);
export const entries = new Map(catalog.map((e) => [e.key, e]));
export const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>\"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[c]!,
  );
export function placeholders(text: string) {
  return [...new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!))].sort();
}
export function validateCopy(key: string, value: string) {
  const entry = entries.get(key);
  if (!entry || !value.trim() || value.length > (entry.button ? 64 : 3500))
    throw new PlatformError(400, 'INVALID_COPY');
  if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(entry.values.en)))
    throw new PlatformError(400, 'INVALID_COPY');
  if (entry.button && /[<>\n]/.test(value)) throw new PlatformError(400, 'INVALID_COPY');
  if (!entry.button) {
    const stack: string[] = [];
    let last = 0;
    for (const m of value.matchAll(/<([^>]+)>/g)) {
      if (value.slice(last, m.index).includes('<')) throw new PlatformError(400, 'INVALID_COPY');
      last = m.index! + m[0].length;
      const tag = m[1]!,
        close = tag.startsWith('/'),
        name = /^\/?([a-z-]+)/.exec(tag)?.[1];
      if (
        !name ||
        ![
          'b',
          'strong',
          'i',
          'em',
          'u',
          'ins',
          's',
          'strike',
          'del',
          'code',
          'pre',
          'a',
          'tg-emoji',
          'tg-spoiler',
          'blockquote',
        ].includes(name)
      )
        throw new PlatformError(400, 'INVALID_COPY');
      if (close) {
        if (tag !== '/' + name || stack.pop() !== name)
          throw new PlatformError(400, 'INVALID_COPY');
      } else {
        if (name === 'a' && !/^a href="(?:https?:\/\/|tg:\/\/|mailto:)[^"<>]+"$/.test(tag))
          throw new PlatformError(400, 'INVALID_COPY');
        if (name === 'tg-emoji' && !/^tg-emoji emoji-id="\d{5,25}"$/.test(tag))
          throw new PlatformError(400, 'INVALID_COPY');
        if (
          !['a', 'tg-emoji'].includes(name) &&
          !new RegExp('^' + name + '(?: expandable)?$').test(tag)
        )
          throw new PlatformError(400, 'INVALID_COPY');
        stack.push(name);
      }
    }
    if (
      stack.length ||
      value.slice(last).includes('<') ||
      /&(?!(?:amp|lt|gt|quot|#\d+|#x[\da-fA-F]+);)/.test(value)
    )
      throw new PlatformError(400, 'INVALID_COPY');
  }
}
export class ManagerContent {
  private rows = new Map<string, unknown>();
  private until = 0;
  private loading?: Promise<void>;
  constructor(private registry: Registry) {}
  async load() {
    if (this.until > Date.now()) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const keys = catalog.flatMap((e) => languages.map((l) => 'text.' + l + '.manager.' + e.key));
      keys.push(
        ...catalog
          .filter((e) => e.button)
          .flatMap((e) => ['btnicon.manager.' + e.key, 'color.manager.' + e.key]),
        'manager.plan.usd',
        'manager.plan.days',
      );
      const { data, error } = await this.registry.db
        .from('settings')
        .select('key,value')
        .or(
          'key.like.text.*.manager.*,key.like.btnicon.manager.*,key.like.color.manager.*,key.like.manager.plan.*',
        );
      if (error) throw new PlatformError(503, 'SETTINGS_UNAVAILABLE');
      const allowed = new Set(keys);
      this.rows = new Map(
        (data ?? []).filter((r: any) => allowed.has(r.key)).map((r: any) => [r.key, r.value]),
      );
      this.until = Date.now() + 60000;
    })().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }
  raw(lang: Language, key: string) {
    const entry = entries.get(key);
    if (!entry) throw new PlatformError(400, 'INVALID_COPY');
    const value = this.rows.get('text.' + lang + '.manager.' + key);
    try {
      if (typeof value !== 'string') throw Error();
      validateCopy(key, value);
      return value;
    } catch {
      return entry.values[lang];
    }
  }
  text(lang: Language, key: string, vars: Record<string, unknown> = {}) {
    return this.raw(lang, key).replace(/\{([a-z_]+)\}/g, (m, k) =>
      Object.hasOwn(vars, k) ? escapeHtml(vars[k]) : m,
    );
  }
  button(
    lang: Language,
    key: string,
    target: string,
    vars: Record<string, unknown> = {},
    url = false,
  ) {
    const icon = this.rows.get('btnicon.manager.' + key) as
      | { unicode?: string; custom_emoji_id?: string }
      | undefined;
    const color = this.rows.get('color.manager.' + key) ?? (['create','begin','confirm','pay','activate'].includes(key)?'green':['super','console','shops','guide','plans'].includes(key)?'blue':'none'),
      style = ({ blue: 'primary', green: 'success', red: 'danger' } as any)[String(color)];
    const text = this.raw(lang, key).replace(/\{([a-z_]+)\}/g, (m, k) => String(vars[k] ?? m));
    return {
      text: ((icon?.unicode && !icon.custom_emoji_id ? icon.unicode + ' ' : '') + text).slice(
        0,
        64,
      ),
      ...(url ? { url: target } : { callback_data: target }),
      ...(icon?.custom_emoji_id && /^\d{5,25}$/.test(icon.custom_emoji_id)
        ? { icon_custom_emoji_id: icon.custom_emoji_id }
        : {}),
      ...(style ? { style } : {}),
    };
  }
  policy() {
    const raw = this.rows.get('manager.plan.usd'),
      days = Number(this.rows.get('manager.plan.days') ?? this.registry.config.days);
    let price = this.registry.config.walletPriceUsd ?? null;
    if (raw !== undefined) {
      try {
        price = raw === '0' ? null : walletPrice(raw);
      } catch {}
    }
    return {
      price,
      days: Number.isInteger(days) && days >= 1 && days <= 365 ? days : this.registry.config.days,
    };
  }
  async set(key: string, value: unknown) {
    const { error } = await this.registry.db
      .from('settings')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw new PlatformError(503, 'SETTINGS_UNAVAILABLE');
    this.rows.set(key, value);
  }
  async reset(key: string) {
    const { error } = await this.registry.db.from('settings').delete().eq('key', key);
    if (error) throw new PlatformError(503, 'SETTINGS_UNAVAILABLE');
    this.rows.delete(key);
  }
}
