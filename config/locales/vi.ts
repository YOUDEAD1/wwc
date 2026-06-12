/* Tiếng Việt — keep keys in sync with en.ts */
export const vi: Record<string, string> = {
  'welcome': 'Chào mừng đến với {storeName}',
  'welcome.title': 'Chào mừng đến với {storeName}!',
  'welcome.balance': 'Số dư của bạn: *${balance}*',
  'welcome.tap_menu': 'Nhấn *Menu Chính* bên dưới để bắt đầu.',
  'welcome.guide': [
    '📌 *Hướng dẫn nhanh:*',
    '',
    '1. Nhấn vào "🛍️ Mua".',
    '',
    '2. Chọn sản phẩm bạn muốn.',
    '',
    '3. Hoàn tất thanh toán.',
    '',
    '4. Sau khi thanh toán, gửi txid hoặc ID đơn hàng của bạn tại đây để xác minh.',
    '',
    '',
    '📌 *Vui lòng chọn một menu:*',
  ].join('\n'),
  'menu.title': '🐯 *{storeName}* — Menu Chính',

  'btn.main_menu': '⬅️ Quay lại',
  'btn.shop': '🛍 Cửa hàng',
  'btn.topup': '👛 Nạp ví',
  'btn.profile': '⚙️ Cài đặt',
  'btn.support': '💬 Hỗ trợ',
  'btn.ai_support': '🥝 Kiwi Ai',
  'btn.back': '⬅️ Quay lại',
  'btn.next': 'Tiếp ▶️',
  'btn.prev': '◀️ Trước',
  'btn.refresh': '🔄 Làm mới',
  'btn.buy_now': '✅ Mua ngay',
  'btn.pre_order': '🛍 Pre Order',
  'btn.redeem_referral': '🎁 Thanh toán bằng giới thiệu',
  'btn.referral_earn_buy': '🔗 Kiếm lượt giới thiệu & Mua',
  'btn.convert_refers': '💱 Đổi Refers sang USDT',
  'btn.topup_wallet': '👛 Nạp ví',
  'btn.view_note': '📝 Xem ghi chú',
  'btn.qty_plus': '➕',
  'btn.qty_minus': '➖',
  'btn.custom_qty': '🔢 Số lượng tùy chỉnh',
  'btn.qty_keypad_back': '⌫',
  'btn.qty_keypad_clear': '🗑 Xóa',
  'btn.qty_keypad_confirm': '✅ Xác nhận',
  // Nút "Tối đa" gán số lượng vào mức tối đa có thể mua
  // (`min(QTY_MAX, tồn kho)`) chỉ với một lần nhấn — tiện cho người mua
  // sỉ muốn lấy hết lô mà không cần nhập từng chữ số.
  'btn.qty_keypad_max': '🎯 Tối đa',
  'btn.pay_wallet': '👛 Ví',
  'btn.pay_referral': '🎁 Referral Pay',
  'btn.pay_direct': '💸 Trực tiếp',
  'btn.pay_topup': '🪙 Nạp',
  'btn.confirm_pay': '✅ Xác nhận',
  'btn.cancel_pay': '◀️ Hủy',
  // Hàng "Khác" và "Quay lại" trên bàn phím phương thức thanh toán.
  // Người dùng Premium thấy biểu tượng động được khai báo ở
  // EMOJI.paymethod_others / paymethod_back; người khác xem ký tự
  // unicode bên dưới làm dự phòng.
  'btn.paymethod_others': '💡 Khác',
  'btn.paymethod_back': '◀️ Quay lại',
  'btn.qty.max': '🎯 Tối đa',
  'btn.qty.reset': '🔄 Đặt lại',
  'btn.qty.confirm': '✅ Xác nhận',
  'btn.contact_admin': '💬 Liên hệ Admin',
  'btn.qty.dec_1': '➖ 1',
  'btn.qty.dec_10': '⏪ 10',
  'btn.qty.dec_100': '⏮ 100',
  'btn.qty.inc_1': '➕ 1',
  'btn.qty.inc_10': '⏩ 10',
  'btn.qty.inc_100': '⏭ 100',
  'btn.qty.display': '📦 {qty} / {stock}',
  'btn.share_product': '🔗 Sao chép liên kết',
  'btn.view_note_file': '📥 Lưu ghi chú dạng TXT',
  'btn.send_note_txt': '📥 Tải TXT',
  'btn.out_of_stock': '❌ Hết hàng',
  'btn.my_orders': '🧾 Đơn hàng của tôi',
  'btn.refer': '🎁 Giới thiệu',
  'btn.notifications': '🔔 Thông báo',
  'btn.toggle_stock': '📢 Thông báo tồn kho',
  'btn.toggle_announcements': '💬 Thông báo tin tức',
  'btn.toggle_wallet': '💰 Thông báo ví',
  // Mỗi nút trên hàng riêng nay có đủ chỗ cho tên đầy đủ và trạng thái.
  'btn.notify.stock.on': '🟢 Thông báo Tồn kho: BẬT',
  'btn.notify.stock.off': '🔕 Thông báo Tồn kho: TẮT',
  'btn.notify.ann.on': '🟢 Thông báo Tin tức: BẬT',
  'btn.notify.ann.off': '🔕 Thông báo Tin tức: TẮT',
  'btn.notify.wallet.on': '🟢 Thông báo Ví: BẬT',
  'btn.notify.wallet.off': '🔕 Thông báo Ví: TẮT',
  'btn.back_to_settings': '⬅️ Quay lại Cài đặt',
  'btn.language': '🌐 Ngôn ngữ',
  'btn.language.english': '🇬🇧 English',
  'btn.language.arabic': '🇸🇦 العربية',
  'btn.language.vietnamese': '🇻🇳 Tiếng Việt',
  'btn.region.clear': '🚫 Xóa',
  'btn.deposit_history': '💳 Lịch sử nạp',
  'btn.channel': 'Kênh',
  'btn.reseller_api': '🔑 Api Key',
  'btn.stats': '📊 Thống kê',
  'btn.stats_refresh': '🔄 Làm mới',
  'btn.stats_back': '◀️ Quay lại',
  // Hướng dẫn theo từng phương thức — hiển thị dưới mỗi màn hình
  // chuỗi / Binance / LTC. Quản trị viên chỉnh nội dung từ trang /admin.
  'btn.where_txid': '📘 Tìm TXID ở đâu?',
  'btn.where_order_id': '📘 Tìm Mã đơn ở đâu?',
  // Hướng dẫn bot + cách dùng (trang Cài đặt).
  'btn.using_method': '📘 Cách dùng',
  'btn.tutorial_open_link': '🔗 Mở liên kết',
  'btn.bot_tutorial': '📘 Hướng dẫn Bot',

  'shop.home.header': '*Sản phẩm có sẵn:*',
  'shop.choose_category': '*Sản phẩm có sẵn:*',
  'shop.qty.prompt': '🔢 Nhập số lượng (1–{max}) và gửi.',
  'shop.qty.invalid': '❌ Số không hợp lệ — vui lòng gửi giá trị từ 1 đến {max}.',
  // Token `{current}` là bộ đệm số người dùng đã nhập đến
  // giờ. Trước khi nhận phím đầu tiên, nó hiển thị dưới dạng
  // văn bản hướng dẫn `(Số lượng)` thay cho dấu gạch ngắn
  // trần trụi «mâu» đã dùng trước đây.
  'shop.qty.keypad.instruction':
    '{qty_prompt_keypad} *Cách dùng:* nhấn các chữ số bên dưới hoặc gửi số, ' +
    'sau đó nhấn ✅ Xác nhận.\n' +
    'Hiện tại: <code>{current}</code>',
  // Placeholder hiển thị trong `Hiện tại: <code>…</code>` khi bộ
  // đệm còn rỗng — đọc tự nhiên hơn ("Hiện tại: (Số lượng)") so
  // với dấu gạch ngắn trần trụi trước đây.
  'shop.qty.keypad.placeholder': '(Số lượng)',
  'shop.qty.keypad.invalid':
    '{qty_invalid} *Số lượng không hợp lệ.*\n\n' +
    'Vui lòng gửi số nguyên từ *1* đến *{max}*.',
  'shop.pay.title':
    '{pay_summary} *Tóm tắt đơn hàng*\n\n' +
    '{emoji} *{name}*\n' +
    '{prod_qty_selected} Số lượng: *{qty}*\n' +
    '{promo_line}' +
    '{prod_total_amount} Tổng: *{total}*\n' +
    '{prod_wallet} Ví: *{balance}*\n' +
    '{referral_line}' +
    'Chọn cách thanh toán:',
  'shop.pay.referral_line':
    '{prod_referral} Referral Pay:\n*{available} có sẵn* • *{required} cần*\n\n',
  // Thẻ xác nhận thanh toán bằng ví (trang 2).
  'shop.pay.confirm':
    '{prod_wallet} *Xác nhận Thanh toán*\n\n' +
    '{pay_summary} *Đơn hàng*\n' +
    '{emoji} *{name}* × *{qty}*\n' +
    '{discount_line}' +
    '{prod_total_amount} *Tổng:* {total}\n' +
    '{prod_wallet} *Ví:* {balance}\n\n' +
    '_Trừ *{total}* từ ví của bạn?_',
  'shop.pay.confirm.discount_line':
    '{prod_promo} *Giảm giá:* −{discount}\n',
  'shop.qty.editor.title':
    '🔢 *Chọn số lượng*\n\n' +
    '*{name}*\n' +
    'Tồn kho: *{stock}*\n' +
    'Đơn giá: *{price}*\n\n' +
    'Đã chọn: <code>{qty}</code>\n' +
    'Tổng: *{total}*',
  'shop.empty_categories': 'Chưa có danh mục. Vui lòng quay lại sau.',
  'shop.empty_products': 'Chưa có sản phẩm trong danh mục này.',
  'shop.product.line.name': '{emoji} *{name}*',
  'shop.product.line.price': '{prod_price_base} *Giá gốc:* {price}',
  'shop.product.line.stock': '{prod_stock} *Còn lại:* {stock}',
  'shop.product.line.warranty': '{prod_warranty} *Bảo hành:* {warranty}',
  'shop.product.line.referral.progress':
    '{prod_referral} *Thanh toán giới thiệu:* Cần {required} • Có {total} • Thiếu {remaining}',
  'shop.product.line.referral.ready':
    '{prod_referral} *Thanh toán giới thiệu:* Cần {required} • Có {total} • Sẵn sàng',
  'shop.product.line.referral.claimed':
    '{prod_referral} *Thanh toán giới thiệu:* Số dư đã dùng ở đơn cũ',
  'shop.product.line.qty': '{prod_qty_selected} *Số lượng đã chọn:* {qty}',
  'shop.product.line.total': '{prod_total_amount} *Tổng tiền:* {total}',
  'shop.product.line.balance': '{prod_wallet} *Ví:* {balance}',
  'shop.product.line.promo':
    '{prod_promo} *Khuyến mãi:* {label} — −{discount}',
  'shop.product.line.promo.fallback_label': 'số lượng ≥ {min_qty}',
  'shop.product.line.promo.teaser':
    '{prod_promo} *Khuyến mãi:* Mua {min_qty}+ giảm −${discount}',
  'shop.product.line.total.discounted':
    '{prod_total_amount} *Tổng tiền:* ~~{gross}~~ {total}',
  'shop.product.out_of_stock_popup':
    '❌ Sản phẩm này hiện đã hết hàng. Vui lòng liên hệ quản trị viên để bổ sung kho hoặc chọn sản phẩm tương tự.',
  'shop.note.title': '📝 *Ghi chú sản phẩm*',
  'shop.note.empty': 'Sản phẩm này không có ghi chú.',
  'shop.note.full': [
    '*📝 Ghi chú sản phẩm — {name}*',
    '',
    '*Giá:* `{price}`',
    '*Kho:* `{stock}`',
    '*Bảo hành:* `{warranty}`',
    '',
    '*Mô tả:*',
    '{description}',
    '',
    '*Ghi chú:*',
    '{note}',
  ].join('\n'),
  'shop.buy.success':
    '✅ Mua thành công!\n\nSản phẩm: *{name}*\nSố lượng: *{qty}*\nTổng: *{total}*\n\nGiao hàng:\n```\n{delivery}\n```',
  'shop.buy.insufficient':
    '❌ Số dư ví không đủ. Cần *{need}* nhưng chỉ có *{have}*. Vui lòng nạp tiền trước.',
  'shop.buy.no_stock': '❌ Xin lỗi, sản phẩm đã hết hàng.',
  'shop.referral.disabled': '❌ Referral Pay chưa được bật cho sản phẩm này.',
  'shop.referral.already_redeemed': '✅ Referral Pay đã được dùng cho một đơn cũ.',
  'shop.referral.insufficient':
    '❌ Cần {required} lượt giới thiệu để đổi. Bạn có {total} (còn {remaining}).',
  'shop.referral.insufficient.card': [
    '⚠️ *Số dư Referral Pay thấp*',
    '',
    '{prod_referral} *Cần:* {required} lượt',
    '{refer_user} *Hiện có:* {available} lượt',
    '{qty_invalid} *Còn thiếu:* {remaining} lượt',
    '',
    '{refer_title} Mời thêm người bằng link giới thiệu, bấm làm mới, rồi thanh toán bằng Referral Pay.',
  ].join('\n'),
  'shop.referral.confirm': [
    '{refer_title} *Xác nhận Referral Pay*',
    '',
    '{emoji} *{name}* × *{qty}*',
    '{prod_referral} *Cần:* {required} lượt',
    '{refer_user} *Hiện có:* {available} lượt',
    '{delivery_check} *Sau khi trả:* {after} lượt',
    '',
    '_Dùng lượt giới thiệu đang có cho đơn này?_',
  ].join('\n'),
  'shop.referral.failed':
    '❌ Không thể thanh toán bằng Referral Pay lúc này. Vui lòng thử lại hoặc liên hệ admin.',
  'shop.referral.confirmed': [
    '{refer_title} *Thanh toán Referral Pay thành công!*',
    '',
    '*Sản phẩm:* {name}',
    '*Số lượng:* {qty}',
    '*Đã dùng:* {spent} lượt',
    '',
    '{delivering} _Đang giao đơn hàng…_',
  ].join('\n'),
  'shop.referral.delivery': 'Referral Pay cho sản phẩm #{product_id} (SL: {qty})',
  'shop.page.header': '🛒 *{category}*\n\n*Sản phẩm có sẵn:*\n_{total} sản phẩm — trang {page}/{pages}_',

  'profile.title': '⚙️ *Cài đặt*',
  'profile.notifications.title': '{notify_bell} *Thông báo*',
  'profile.notifications.body':
    '{notify_on} _Chỉ bật những thông báo bạn thích_ {notify_bell}\n\n' +
    '{notify_stock} *Thông báo tồn kho*\n' +
    '{notify_info} *Thông báo tin tức*\n' +
    '{notify_wallet} *Thông báo ví*\n\n' +
    '{notify_on} BẬT\n' +
    '{notify_off} TẮT',
  'profile.user_id': 'ID người dùng: `{id}`',
  'profile.username': 'Tên người dùng: @{username}',
  'profile.balance': '👛 Số dư: *{balance}*',
  'profile.language': '🌐 Ngôn ngữ: *{language}*',
  'profile.joined': '📅 Tham gia: *{joined}*',
  // Màn hình Giới thiệu & Kiếm.
  'profile.refer.title': '{refer_title} *Giới thiệu & Kiếm*',
  'profile.refer.body':
    '{refer_prize_l} *Giới thiệu 10 người và thắng $0.50* {refer_prize_r}\n\n' +
    '{refer_clicks} *Clicks:* {clicks}\n' +
    '{refer_pending} *Pending:* {pending}\n' +
    '{refer_active} *Active:* {active}\n' +
    '{refer_left} *Left:* {left}\n' +
    '{refer_total} *Giới thiệu (Tổng):* {refTotal}\n' +
    '{refer_coin} *Tổng đã kiếm:* {earnedTotal} USDT\n' +
    '{refer_withdrawn} *Đã rút:* {withdrawn} USDT\n\n' +
    '{prod_referral} *Số dư Referral Pay:* {refAvailable} lượt\n' +
    '{refer_spent} *Đã dùng mua hàng:* {refSpent} lượt\n\n' +
    '> Chuyển lợi nhuận vào ví bất kỳ lúc nào. Rút tiền mặt liên hệ hỗ trợ (tối thiểu $1.00).\n\n' +
    '*Liên kết giới thiệu của bạn:*\n`{link}`',
  'profile.refer.convert_success':
    '💱 Đã đổi *{refs} refs* thành *{amount} USDT*.\n\n💳 Số dư ví: *{balance}*',
  'profile.refer.convert_low':
    '⚠️ Không đủ refs để đổi.\n\nBạn cần *20 refs hoạt động* để đổi thành *1 USDT*.\nSố dư Referral Pay hiện tại: *{available} refs*',
  'profile.refer.convert_error':
    '⚠️ Không thể đổi refs lúc này. Vui lòng thử lại.',
  'btn.live_refers': '🔵 See Your Live Refers',
  'btn.currency': '💱 Currency',
  'btn.stats.24h': '24h',
  'btn.stats.7d': '7d',
  'btn.stats.30d': '30d',
  'btn.stats.custom': 'Custom',
  'profile.currency.title': '💱 *Choose Currency*',
  'profile.currency.body':
    'Your product prices will show your selected currency plus USDT. Payments still use USDT.',
  'profile.currency.saved': '✅ Currency set to {currency}.',
  'profile.currency.error':
    '⚠️ Could not save currency yet. Please apply migration `0033_user_currency.sql` first.',
  'btn.copy_link': '📋 Sao chép',
  'btn.redeem': '🎁 Mã quà tặng',
  'profile.language.title': '{lang_left} *Chọn ngôn ngữ* {lang_right}',
  'profile.email.hub.title': '{email_bracket_l} *Cài đặt Email* {profile_email}',
  'profile.email.hub.body':
    '{email_invoice} Chúng tôi chỉ dùng email cho biên lai mua hàng và khôi phục tài khoản — không quảng cáo.\n\n' +
    '{profile_email} *Email hiện tại:* `{current}`',
  'profile.email.set.already_set_popup':
    'Email đã được thiết lập ({current}). Vui lòng dùng Đổi Email hoặc Xóa Email để cập nhật.',
  'profile.email.delete.no_email_popup': 'Chưa có email — không có gì để xóa.',
  'profile.email.delete.title': '{email_bracket_l} *Xóa Email* {email_bracket_l}',
  'profile.email.delete.body':
    '{email_invalid} _Vui lòng xác nhận xóa email_\n\n' +
    '{profile_email} *Email hiện tại:* `{current}`',
  'profile.email.delete.success': '✅ Đã xóa email.',
  'profile.email.in_use':
    '{email_in_use} Email đã được *sử dụng*\n\n' +
    '{email_arrow} *_Vui lòng nhập một email khác_*',
  'btn.email.delete': '🗑 Xóa Email',
  'btn.email.delete.confirm': '🗑 Xác nhận xóa',
  'btn.email.delete.cancel': '⬅️ Hủy',
  // Nút "Gửi PDF" cho màn hình Đơn hàng / Nạp tiền / Thống kê.
  'btn.send_pdf.orders': 'Gửi PDF đơn hàng đến email',
  'btn.send_pdf.deposits': '📤 Gửi PDF nạp tiền đến email',
  'btn.send_pdf.stats': '📤 Gửi PDF thống kê đến email',
  'pdf.no_email_popup':
    '⚠️ Vui lòng đặt email trước. Cài đặt → Cài đặt email → Đặt email, sau đó quay lại và nhấn Gửi PDF.',
  'pdf.sending_popup': '⏳ Đang tạo PDF và gửi đến {email}…',
  'pdf.sent_popup': '✅ Đã gửi PDF đến {email}. Vui lòng kiểm tra hộp thư (và mục Spam).',
  // Tin nhắn xác nhận khi gửi PDF thành công.
  'pdf.sent_message': '{pdf_sent_l} *PDF đã được gửi tới email* {pdf_sent_r}',
  'pdf.failed_popup':
    '❌ Không gửi được PDF đến {email}. Vui lòng thử lại sau ít phút — nếu lỗi tiếp tục, hãy liên hệ hỗ trợ.',
  'orders.empty':
    '{orders_title} *Đơn hàng của tôi*\n\n' +
    '🪄 Chưa có đơn hàng nào.\n\n' +
    '✨ 🛍️ 🚀 Bắt đầu mua sắm và đơn hàng sẽ xuất hiện ở đây!',
  'profile.orders.empty': 'Bạn chưa có đơn hàng nào.',
  'profile.orders.title': '🧾 *Đơn hàng của tôi*',
  'profile.orders.line': '#{id} • {name} ×{qty} • {total} • {date}',
  'profile.notify.stock_on': 'Thông báo tồn kho: ✅ BẬT',
  'profile.notify.stock_off': 'Thông báo tồn kho: ⛔ TẮT',
  'profile.notify.ann_on': 'Thông báo tin tức: ✅ BẬT',
  'profile.notify.ann_off': 'Thông báo tin tức: ⛔ TẮT',
  'profile.notify.wallet_on': 'Thông báo ví: ✅ BẬT',
  'profile.notify.wallet_off': 'Thông báo ví: ⛔ TẮT',
  'profile.notify.error':
    '⚠️ Không thể lưu trạng thái — cần áp dụng `0008_wallet_alert.sql` vào cơ sở dữ liệu.',
  'profile.deposits.title': '💳 *Lịch sử nạp*',
  'profile.deposits.empty': 'Chưa có giao dịch nạp.',
  'profile.deposits.line': '#{id} • {amount} • {method} • {status} • {date}',

  'profile.stats.title': 'Thống kê của bạn',
  'profile.stats.orders': 'Đơn hàng: {count}',
  'profile.stats.items': 'Mặt hàng đã mua: {count}',
  'profile.stats.spent': 'Tổng đã chi: {amount} USDT',
  'profile.stats.last': 'Đơn cuối: {rel} ({abs})',
  'profile.stats.last_none': 'Đơn cuối: —',
  'profile.stats.deposits': 'Nạp tiền: {amount} USDT',
  'profile.stats.rel.now': 'vừa xong',
  'profile.stats.rel.minutes': '{n} phút trước',
  'profile.stats.rel.hours': '{n} giờ trước',
  'profile.stats.rel.days': '{n} ngày trước',

  // Hướng dẫn theo phương thức — quản trị chỉnh từ /admin và xuất
  // hiện dưới các màn hình USDT / Binance / LTC. Tiêu đề mang biểu
  // tượng sách + tên phương thức, nội dung lấy từ
  // `pay_tutorial.<method_id>.text`.
  'pay.tutorial.title': '{tutorial} *Tìm tham chiếu ở đâu — {method}*',
  'pay.tutorial.empty':
    '_Quản trị viên chưa thêm hướng dẫn cho phương thức này. Vui lòng quay lại sau._',
  'pay.tutorial.body': '{body}',

  'topup.title': '👛 *Nạp ví*',
  'topup.choose_method': '👛 *Nạp ví*',
  'topup.empty_methods': 'Chưa cấu hình phương thức thanh toán. Vui lòng liên hệ hỗ trợ.',
  'topup.method.body': '*{name}*\n\n{instructions}',
  'topup.requested':
    '✅ Yêu cầu nạp đã gửi (#{id}).\nQuản trị viên sẽ xác nhận và cộng tiền sớm.',

  'support.title': '{support_title} Hỗ trợ',
  'support.body':
    '_*Nếu bạn không thể gửi tin nhắn hoặc gặp sự cố, hãy sử dụng Hỗ trợ trực tiếp để kết nối ngay với quản trị viên.*_',
  'support.btn.contact': '📩 Liên hệ quản trị',
  'support.contact_prefill': 'Chào, tôi cần trợ giúp về ShopBot {storeName}. Vui lòng giúp tôi về: ',
  'support.btn.cancel': 'Hủy hỗ trợ',
  'support.btn.live': '🟢 Hỗ trợ trực tiếp',
  'support.btn.end_session': '🔴 Kết thúc phiên',
  'support.live.busy_popup':
    '⏳ Quản trị viên đang hỗ trợ người khác. Vui lòng thử lại sau ít phút.',
  'support.live.user_active':
    '{support_live_active} Hỗ trợ trực tiếp\n\n' +
    'Phiên hỗ trợ đang hoạt động.\n\n' +
    'Hãy nhắn tin trực tiếp tại đây — mọi tin nhắn sẽ được chuyển ngay đến quản trị viên. Bấm *Hủy hỗ trợ* bất cứ lúc nào để kết thúc phiên.',
  'support.live.session_created': '🟢 *Đã tạo phiên Hỗ trợ trực tiếp*',
  'support.live.admin_started':
    '🟢 *Bắt đầu Hỗ trợ trực tiếp*\n\n' +
    'Người dùng: *{name}* (@{username})\nID: `{id}`\n\nTrả lời tại đây để chat. Gửi /end để đóng phiên.',
  'support.live.admin_relay': '*[{name}]:* {text}',
  'support.live.admin_media_header': '*[{name}]* đã gửi tệp:',
  'support.live.user_ended':
    '{support_live_closed} Đã đóng Hỗ trợ trực tiếp.\n\n' +
    'Mở lại Hỗ trợ từ menu bất kỳ lúc nào bạn cần giúp đỡ.',
  'support.live.admin_ended': '🔴 *Phiên Hỗ trợ trực tiếp đã đóng.*',
  'support.live.unavailable_popup':
    '⚠️ Hỗ trợ trực tiếp tạm thời không khả dụng — không thể liên lạc với quản trị viên ngay bây giờ. Vui lòng dùng Liên hệ Admin hoặc thử lại sau.',
  'support.live.unavailable_message':
    '⚠️ *Hỗ trợ trực tiếp không khả dụng*\n\n' +
    'Hiện không thể liên lạc với quản trị viên. Thường là do quản trị viên chưa từng mở bot này và bấm *Start* — Telegram chỉ cho phép bot nhắn cho người đã chủ động bắt đầu trò chuyện.\n\n' +
    'Vui lòng dùng *Liên hệ Admin* trong menu Hỗ trợ.',
  'support.btn.email_transcript': '📧 Gửi PDF chat tới email',
  'support.transcript.sent_message':
    '{pdf_sent_l} *PDF đã được gửi tới email* {pdf_sent_r}',
  'support.transcript.no_email_popup':
    '⚠️ Hãy đặt email trước. Cài đặt → Cài đặt email → Đặt email, sau đó quay lại và nhấn nút gửi PDF chat.',
  'support.transcript.sending_popup':
    '⏳ Đang tạo bản ghi hỗ trợ và gửi đến {email}…',
  'support.transcript.failed_popup':
    '❌ Không gửi được bản ghi đến {email}. Vui lòng thử lại — nếu lỗi tiếp tục, hãy liên hệ hỗ trợ.',
  'support.transcript.expired_popup':
    '⌛ Bản ghi này không còn khả dụng. Bắt đầu phiên Hỗ trợ trực tiếp mới khi bạn cần giúp đỡ.',
  'support.ai.session_open':
    '{kiwi_ai} *Kiwi Ai*\n' +
    '*Tôi là Kiwi, trợ lý hỗ trợ tự động.*\n\n' +
    'Bạn có thể hỏi bất kỳ câu hỏi nào bằng bất kỳ ngôn ngữ nào ' +
    'hoặc được hỗ trợ về sản phẩm, giá, kho hàng, nạp tiền, mã ' +
    'giảm giá, đơn hàng và giao hàng. Thông tin nội bộ hệ thống ' +
    'không được tiết lộ.',
  'support.ai.user_ended':
    '{support_live_closed} Đã đóng Kiwi Ai.\n\n' +
    'Mở lại Kiwi Ai từ menu bất kỳ lúc nào bạn cần giúp đỡ.',
  'support.ai.fallback':
    'Tôi không thể trả lời tự động. Một nhân viên sẽ liên hệ sớm.',
  'support.ai.pdf_prompt':
    '{kiwi_ai} *Đã lưu hội thoại Kiwi Ai.*\n' +
    'Nhấn bên dưới để gửi bản ghi về email của bạn dưới dạng PDF.',
  'support.ai.empty_popup':
    '💬 Hãy gửi ít nhất một câu hỏi trước — chưa có gì để lưu.',
  'support.ai.title': '{kiwi_ai} *Kiwi Ai*',
  'support.ai.prompt': 'Mô tả vấn đề và tôi sẽ cố gắng hỗ trợ.',
  'channel.not_set': '📢 Liên kết kênh chưa được cài đặt.',
  'channel.subscribe.title': '📢 *Tham gia kênh* để tiếp tục',
  'channel.subscribe.body': 'Vui lòng tham gia kênh bên dưới rồi nhấn *Tôi đã tham gia*.',
  'channel.subscribe.joined': '✅ Tôi đã tham gia',

  'admin.only': '⛔ Chỉ dành cho quản trị viên.',
  'admin.help.title': '🛠 *Lệnh quản trị*',
  'admin.cache.cleared': '🧹 Đã xóa cache.',

  'admin.text.set': '✅ Đã cập nhật text `{key}`.',
  'admin.color.set': '✅ Màu `{key}` đặt thành *{color}*.',
  'admin.emoji.set': '✅ Đã cập nhật emoji `{key}`.',
  'admin.product.added': '✅ Đã thêm sản phẩm *{name}* (id={id}).',
  'admin.category.added': '✅ Đã thêm danh mục *{name}* (id={id}).',
  'admin.payment.added': '✅ Đã thêm phương thức thanh toán *{name}* (id={id}).',
  'admin.bad_args': '❌ Tham số sai. Cách dùng: `{usage}`',

  'err.generic': '⚠️ Đã xảy ra lỗi. Vui lòng thử lại.',
  'err.unknown_action': '⚠️ Hành động không xác định.',
};