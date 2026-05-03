/* العربية — keep keys in sync with en.ts */
export const ar: Record<string, string> = {
  'welcome': 'مرحبًا بك في متجر SafwanTiger',
  'welcome.title': 'مرحبًا بك في متجر SafwanTiger!',
  'welcome.balance': 'رصيدك: *${balance}*',
  'welcome.tap_menu': 'اضغط *القائمة الرئيسية* بالأسفل للبدء.',
  'menu.title': '🐯 *متجر SafwanTiger* — القائمة الرئيسية',

  'btn.main_menu': '⬅️ رجوع',
  'btn.shop': '🛍 المتجر',
  'btn.topup': '🪙 شحن',
  'btn.profile': '⚙️ الإعدادات',
  'btn.support': '💬 الدعم',
  'btn.ai_support': '🤖 مساعد آلي',
  'btn.back': '⬅️ رجوع',
  'btn.next': 'التالي ▶️',
  'btn.prev': '◀️ السابق',
  'btn.refresh': '🔄 تحديث',
  'btn.buy_now': '✅ شراء الآن',
  'btn.topup_wallet': '👛 شحن المحفظة',
  'btn.view_note': '📝 عرض الملاحظة',
  'btn.qty_plus': '➕',
  'btn.qty_minus': '➖',
  'btn.qty.max': 'الحد الأقصى',
  'btn.qty.reset': 'إعادة',
  'btn.qty.confirm': '✅ تأكيد',
  'btn.contact_admin': '💬 تواصل مع الإدارة',
  'btn.out_of_stock': '❌ غير متوفر',
  'btn.my_orders': '🧾 طلباتي',
  'btn.refer': '🎁 إحالة',
  'btn.notifications': '🔔 الإشعارات',
  'btn.toggle_stock': '📢 تنبيهات المخزون',
  'btn.toggle_announcements': '💬 تنبيهات عامة',
  'btn.toggle_wallet': '💰 تنبيهات المحفظة',
  // كل زر على صف مستقل، لذلك نعرض الاسم الكامل وحالة التفعيل.
  'btn.notify.stock.on': '🟢 تنبيهات المخزون: مفعلة',
  'btn.notify.stock.off': '🔕 تنبيهات المخزون: معطلة',
  'btn.notify.ann.on': '🟢 تنبيهات عامة: مفعلة',
  'btn.notify.ann.off': '🔕 تنبيهات عامة: معطلة',
  'btn.notify.wallet.on': '🟢 تنبيهات المحفظة: مفعلة',
  'btn.notify.wallet.off': '🔕 تنبيهات المحفظة: معطلة',
  'btn.back_to_settings': '⬅️ رجوع للإعدادات',
  'btn.language': '🌐 اللغة',
  'btn.language.english': '🇬🇧 English',
  'btn.language.arabic': '🇸🇦 العربية',
  'btn.language.vietnamese': '🇻🇳 Tiếng Việt',
  'btn.region.clear': '🚫 مسح',
  'btn.deposit_history': '💳 سجل الإيداعات',
  'btn.channel': 'القناة',
  'btn.stats': '📊 إحصائيات',
  'btn.stats_refresh': '🔄 تحديث',
  'btn.stats_back': '◀️ رجوع',

  'shop.home.header': '*المنتجات المتاحة:*',
  'shop.choose_category': '*المنتجات المتاحة:*',
  'shop.qty.prompt': '🔢 اكتب الكمية (1–{max}) وأرسل.',
  'shop.qty.invalid': '❌ رقم غير صالح — أرسل قيمة بين 1 و {max}.',
  'shop.qty.editor.title':
    '🔢 *اختر الكمية*\n\n' +
    '*{name}*\n' +
    'المخزون: *{stock}*\n' +
    'السعر للوحدة: *{price} USDT*\n\n' +
    'المحدد: <code>{qty}</code>\n' +
    'الإجمالي: *{total} USDT*',
  'shop.empty_categories': 'لا توجد فئات بعد. يرجى التحقق لاحقًا.',
  'shop.empty_products': 'لا توجد منتجات في هذه الفئة بعد.',
  'shop.product.line.name': '*{name}*',
  'shop.product.line.price': '💰 السعر: *{price}*',
  'shop.product.line.stock': '📦 المخزون: *{stock}*',
  'shop.product.line.warranty': '🛡️ الضمان: {warranty}',
  'shop.product.line.qty': '🔢 الكمية المختارة: *{qty}*',
  'shop.product.line.total': '🧮 الإجمالي: *{total}*',
  'shop.product.line.balance': '👛 المحفظة: *{balance}*',
  'shop.note.title': '📝 *ملاحظة المنتج*',
  'shop.note.empty': 'لا توجد ملاحظة لهذا المنتج.',
  'shop.buy.success':
    '✅ تمت عملية الشراء!\n\nالمنتج: *{name}*\nالكمية: *{qty}*\nالإجمالي: *{total}*\n\nالتسليم:\n```\n{delivery}\n```',
  'shop.buy.insufficient': '❌ رصيد غير كافٍ. تحتاج *{need}* ولديك *{have}* فقط. يرجى الشحن أولاً.',
  'shop.buy.no_stock': '❌ عذرًا، هذا المنتج غير متوفر.',
  'shop.page.header': '🛒 *{category}*\n\n*المنتجات المتاحة:*\n_{total} منتج — صفحة {page}/{pages}_',

  'profile.title': '⚙️ *الإعدادات*',
  'profile.notifications.title': '{notify_bell} *الإشعارات*',
  'profile.notifications.body':
    '{notify_on} _فعّل فقط التنبيهات التي تهمّك_ {notify_bell}\n\n' +
    '{notify_stock} *تنبيهات المخزون*\n' +
    '{notify_info} *تنبيهات عامة*\n' +
    '{notify_wallet} *تنبيهات المحفظة*\n\n' +
    '{notify_on} مفعلة\n' +
    '{notify_off} معطلة',
  'profile.user_id': 'معرف المستخدم: `{id}`',
  'profile.username': 'اسم المستخدم: @{username}',
  'profile.balance': '👛 الرصيد: *{balance}*',
  'profile.language': '🌐 اللغة: *{language}*',
  'profile.joined': '📅 الانضمام: *{joined}*',
  // شاشة الإحالة والتربح.
  'profile.refer.title': '{refer_title} *إحالة وتربح*',
  'profile.refer.body':
    '{refer_user} *الإحالات (24س):* {ref24h}\n' +
    '{refer_user} *الإحالات (7أ):* {ref7d}\n' +
    '{refer_user} *الإحالات (الإجمالي):* {refTotal}\n\n' +
    '{refer_coin} *إجمالي الأرباح:* {earnedTotal} USDT\n' +
    '{refer_coin} *المتاح:* {available} USDT\n' +
    '{refer_transferred} *المحول:* {transferred} USDT\n' +
    '{refer_withdrawn} *المسحوب:* {withdrawn} USDT\n\n' +
    '> اربح 1٪ من كل شحن يقوم به مستخدموك المدعوون.\n' +
    '> بحد أقصى 1$ لكل عملية شحن.\n' +
    '> حوّل الأرباح إلى المحفظة في أي وقت. للسحب النقدي تواصل مع الدعم (الحد الأدنى 1$).\n\n' +
    '*رابط الإحالة الخاص بك:*\n`{link}`',
  'btn.copy_link': '📋 نسخ الرابط',
  'btn.redeem': '🎁 رمز هدية',
  'profile.language.title': '{lang_left} *اختر اللغة* {lang_right}',
  'profile.email.hub.title': '{email_bracket_l} *إعدادات البريد* {profile_email}',
  'profile.email.hub.body':
    '{email_invoice} نستخدم بريدك لإرسال الفواتير واستعادة الحساب فقط — لن نرسل أي رسائل تسويقية.\n\n' +
    '{profile_email} *البريد الحالي:* `{current}`',
  'profile.email.set.already_set_popup':
    'تم تعيين البريد بالفعل ({current}). استخدم تغيير البريد أو حذف البريد لتحديثه.',
  'profile.email.delete.no_email_popup': 'لا يوجد بريد محفوظ — لا شيء لحذفه.',
  'profile.email.delete.title': '{email_bracket_l} *حذف البريد* {email_bracket_l}',
  'profile.email.delete.body':
    '{email_invalid} _يرجى التأكيد لحذف البريد_\n\n' +
    '{profile_email} *البريد الحالي:* `{current}`',
  'profile.email.delete.success': '✅ تم حذف البريد.',
  'profile.email.in_use':
    '{email_in_use} هذا البريد *مستخدم* بالفعل\n\n' +
    '{email_arrow} *_يرجى إدخال بريد إلكتروني آخر_*',
  'btn.email.delete': '🗑 حذف البريد',
  'btn.email.delete.confirm': '🗑 تأكيد الحذف',
  'btn.email.delete.cancel': '⬅️ إلغاء',
  // أزرار "إرسال PDF" في شاشات الطلبات / الإيداعات / الإحصائيات.
  'btn.send_pdf.orders': 'إرسال PDF الطلبات إلى البريد',
  'btn.send_pdf.deposits': '📤 إرسال PDF الإيداعات إلى البريد',
  'btn.send_pdf.stats': '📤 إرسال PDF الإحصائيات إلى البريد',
  'pdf.no_email_popup':
    '⚠️ يرجى ضبط البريد الإلكتروني أولًا. الإعدادات → إعدادات البريد → ضبط البريد، ثم عُد واضغط "إرسال PDF".',
  'pdf.sending_popup': '⏳ جارٍ إنشاء PDF وإرساله إلى {email}…',
  'pdf.sent_popup': '✅ تم إرسال PDF إلى {email}. تحقّق من البريد الوارد (وملف الرسائل غير المرغوب فيها).',
  // رسالة دردشة تظهر عند نجاح إرسال PDF.
  'pdf.sent_message': '{pdf_sent_l} *تم إرسال PDF إلى البريد* {pdf_sent_r}',
  'pdf.failed_popup':
    '❌ تعذّر إرسال PDF إلى {email}. حاول مرة أخرى بعد قليل — وتواصل مع الدعم إذا تكرّر الخطأ.',
  'orders.empty':
    '{orders_title} *طلباتي*\n\n' +
    '🪄 لا توجد طلبات بعد.\n\n' +
    '✨ 🛍️ 🚀 ابدأ التسوق وستظهر طلباتك هنا!',
  'profile.orders.empty': 'لا توجد طلبات بعد.',
  'profile.orders.title': '🧾 *طلباتي*',
  'profile.orders.line': '#{id} • {name} ×{qty} • {total} • {date}',
  'profile.notify.stock_on': 'تنبيهات المخزون: ✅ مفعلة',
  'profile.notify.stock_off': 'تنبيهات المخزون: ⛔ معطلة',
  'profile.notify.ann_on': 'تنبيهات عامة: ✅ مفعلة',
  'profile.notify.ann_off': 'تنبيهات عامة: ⛔ معطلة',
  'profile.notify.wallet_on': 'تنبيهات المحفظة: ✅ مفعلة',
  'profile.notify.wallet_off': 'تنبيهات المحفظة: ⛔ معطلة',
  'profile.notify.error':
    '⚠️ تعذر حفظ التبديل — يجب تطبيق `0008_wallet_alert.sql` على قاعدة البيانات.',
  'profile.deposits.title': '💳 *سجل الإيداعات*',
  'profile.deposits.empty': 'لا توجد إيداعات بعد.',
  'profile.deposits.line': '#{id} • {amount} • {method} • {status} • {date}',

  'profile.stats.title': 'إحصائياتك',
  'profile.stats.orders': 'الطلبات: {count}',
  'profile.stats.items': 'العناصر المشتراة: {count}',
  'profile.stats.spent': 'إجمالي الإنفاق: {amount} USDT',
  'profile.stats.last': 'آخر طلب: {rel} ({abs})',
  'profile.stats.last_none': 'آخر طلب: —',
  'profile.stats.deposits': 'الإيداعات: {amount} USDT',
  'profile.stats.rel.now': 'الآن',
  'profile.stats.rel.minutes': 'منذ {n} د',
  'profile.stats.rel.hours': 'منذ {n} س',
  'profile.stats.rel.days': 'منذ {n} ي',

  'topup.title': '👛 *شحن المحفظة*',
  'topup.choose_method': 'اختر طريقة الدفع:',
  'topup.empty_methods': 'لا توجد طرق دفع مكوّنة. يرجى التواصل مع الدعم.',
  'topup.method.body': '*{name}*\n\n{instructions}\n\nالحد الأدنى: *{min}*',
  'topup.requested': '✅ تم تقديم طلب الشحن (#{id}).\nسيتم التحقق وإضافة الرصيد قريبًا.',

  'support.title': '{support_title} الدعم',
  'support.body':
    '_*إذا تعذّر عليك إرسال رسالة أو واجهتك مشكلة، استخدم الدعم المباشر للتواصل مع المسؤول مباشرة.*_',
  'support.btn.contact': '📩 تواصل مع المسؤول',
  'support.contact_prefill': 'مرحبًا، أحتاج مساعدة بخصوص ShopBot SafwanTiger، الرجاء المساعدة بشأن: ',
  'support.btn.cancel': 'إلغاء الدعم',
  'support.btn.live': '🟢 الدعم المباشر',
  'support.btn.end_session': '🔴 إنهاء الجلسة',
  'support.live.busy_popup': '⏳ المسؤول مشغول حاليًا مع مستخدم آخر. حاول مرة أخرى بعد قليل.',
  'support.live.user_active':
    '{support_live_active} الدعم المباشر\n\n' +
    'جلسة الدعم فعّالة.\n\n' +
    'الرجاء إرسال رسالتك عبر لوحة الدعم المباشر أعلاه في هذه المحادثة.',
  'support.live.session_created': '🟢 *تم إنشاء جلسة دعم مباشر*',
  'support.live.admin_started':
    '🟢 *بدأ الدعم المباشر*\n\n' +
    'المستخدم: *{name}* (@{username})\nID: `{id}`\n\nردّ هنا للدردشة. أرسل /end لإنهاء الجلسة.',
  'support.live.admin_relay': '*[{name}]:* {text}',
  'support.live.admin_media_header': '*[{name}]* أرسل ملفًا:',
  'support.live.user_ended':
    '{support_live_closed} تم إغلاق الدعم المباشر.\n\n' +
    'افتح الدعم مرّة أخرى من القائمة عند حاجتك للمساعدة.',
  'support.live.admin_ended': '🔴 *تم إغلاق جلسة الدعم المباشر.*',
  'support.ai.title': '🤖 *مساعد الدعم الآلي*',
  'support.ai.prompt': 'اشرح مشكلتك وسأبذل قصارى جهدي للمساعدة.',
  'support.ai.fallback': 'لم أستطع الإجابة تلقائيًا. سيتواصل معك أحد المسؤولين قريبًا.',
  'channel.not_set': '📢 لم يتم ضبط رابط القناة بعد.',
  'channel.subscribe.title': '📢 *انضم إلى قناتنا* للمتابعة',
  'channel.subscribe.body': 'يرجى الانضمام أدناه ثم الضغط على *لقد انضممت*.',
  'channel.subscribe.joined': '✅ لقد انضممت',

  'admin.only': '⛔ للمسؤول فقط.',
  'admin.help.title': '🛠 *أوامر المسؤول*',
  'admin.cache.cleared': '🧹 تم مسح الكاش.',

  'admin.text.set': '✅ تم تحديث النص `{key}`.',
  'admin.color.set': '✅ تم تعيين لون `{key}` إلى *{color}*.',
  'admin.emoji.set': '✅ تم تحديث الإيموجي `{key}`.',
  'admin.product.added': '✅ تمت إضافة المنتج *{name}* (id={id}).',
  'admin.category.added': '✅ تمت إضافة الفئة *{name}* (id={id}).',
  'admin.payment.added': '✅ تمت إضافة طريقة الدفع *{name}* (id={id}).',
  'admin.bad_args': '❌ معاملات خاطئة. الاستخدام: `{usage}`',

  'err.generic': '⚠️ حدث خطأ. حاول مرة أخرى.',
  'err.unknown_action': '⚠️ إجراء غير معروف.',
};
