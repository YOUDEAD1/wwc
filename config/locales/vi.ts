/* Tiếng Việt — keep keys in sync with en.ts */
export const vi: Record<string, string> = {
  'welcome': 'Chào mừng đến với SafwanTiger Shop',
  'welcome.title': 'Chào mừng đến với SafwanTiger Shop!',
  'welcome.balance': 'Số dư của bạn: *${balance}*',
  'welcome.tap_menu': 'Nhấn *Menu Chính* bên dưới để bắt đầu.',
  'menu.title': '🐯 *SafwanTiger Shop* — Menu Chính',

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
  'btn.topup_wallet': '👛 Nạp ví',
  'btn.view_note': '📝 Xem ghi chú',
  'btn.qty_plus': '➕',
  'btn.qty_minus': '➖',
  'btn.custom_qty': '🔢 Số lượng tùy chỉnh',
  'btn.qty_keypad_back': '⌫',
  'btn.qty_keypad_clear': '🗑 Xóa',
  'btn.qty_keypad_confirm': '✅ Xác nhận',
  'btn.pay_wallet': '👛 Ví',
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
  'btn.send_note_txt': '📥 Lưu dạng TXT',
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
  'btn.stats': '📊 Thống kê',
  'btn.stats_refresh': '🔄 Làm mới',
  'btn.stats_back': '◀️ Quay lại',

  'shop.home.header': '*Sản phẩm có sẵn:*',
  'shop.choose_category': '*Sản phẩm có sẵn:*',
  'shop.qty.prompt': '🔢 Nhập số lượng (1–{max}) và gửi.',
  'shop.qty.invalid': '❌ Số không hợp lệ — vui lòng gửi giá trị từ 1 đến {max}.',
  'shop.qty.keypad.instruction':
    '{qty_prompt_keypad} *Cách dùng:* nhấn các chữ số bên dưới hoặc gửi số, ' +
    'sau đó nhấn ✅ Xác nhận.\n' +
    'Hiện tại: <code>{current}</code>',
  'shop.qty.keypad.invalid':
    '{qty_invalid} *Số lượng không hợp lệ.*\n\n' +
    'Vui lòng gửi số nguyên từ *1* đến *{max}*.',
  'shop.pay.title':
    '{pay_summary} *Tóm tắt đơn hàng*\n\n' +
    '{emoji} *{name}*\n' +
    '{prod_qty_selected} Số lượng: *{qty}*\n' +
    '{promo_line}' +
    '{prod_total_amount} Tổng: *{total} USDT*\n' +
    '{prod_wallet} Ví: *{balance} USDT*\n\n' +
    'Chọn cách thanh toán:',
  // Thẻ xác nhận thanh toán bằng ví (trang 2).
  'shop.pay.confirm':
    '{prod_wallet} *Xác nhận Thanh toán*\n\n' +
    '{pay_summary} *Đơn hàng*\n' +
    '{emoji} *{name}* × *{qty}*\n' +
    '{discount_line}' +
    '{prod_total_amount} *Tổng:* {total} USDT\n' +
    '{prod_wallet} *Ví:* {balance} USDT\n\n' +
    '_Trừ *{total} USDT* từ ví của bạn?_',
  'shop.pay.confirm.discount_line':
    '{prod_promo} *Giảm giá:* −{discount} USDT\n',
  'shop.qty.editor.title':
    '🔢 *Chọn số lượng*\n\n' +
    '*{name}*\n' +
    'Tồn kho: *{stock}*\n' +
    'Đơn giá: *{price} USDT*\n\n' +
    'Đã chọn: <code>{qty}</code>\n' +
    'Tổng: *{total} USDT*',
  'shop.empty_categories': 'Chưa có danh mục. Vui lòng quay lại sau.',
  'shop.empty_products': 'Chưa có sản phẩm trong danh mục này.',
  'shop.product.line.name': '{emoji} *{name}*',
  'shop.product.line.price': '{prod_price_base} *Giá gốc:* {price} USDT',
  'shop.product.line.stock': '{prod_stock} *Còn lại:* {stock}',
  'shop.product.line.warranty': '{prod_warranty} *Bảo hành:* {warranty}',
  'shop.product.line.qty': '{prod_qty_selected} *Số lượng đã chọn:* {qty}',
  'shop.product.line.total': '{prod_total_amount} *Tổng tiền:* {total} USDT',
  'shop.product.line.balance': '{prod_wallet} *Ví:* {balance} USDT',
  'shop.product.line.promo':
    '{prod_promo} *Khuyến mãi:* {label} — −{discount} USDT',
  'shop.product.line.promo.fallback_label': 'số lượng ≥ {min_qty}',
  'shop.product.line.promo.teaser':
    '{prod_promo} *Khuyến mãi:* Mua {min_qty}+ giảm −${discount}',
  'shop.product.line.total.discounted':
    '{prod_total_amount} *Tổng tiền:* ~~{gross}~~ {total} USDT',
  'shop.product.out_of_stock_popup':
    '❌ Sản phẩm này hiện đã hết hàng. Vui lòng liên hệ quản trị viên để bổ sung kho hoặc chọn sản phẩm tương tự.',
  'shop.note.title': '📝 *Ghi chú sản phẩm*',
  'shop.note.empty': 'Sản phẩm này không có ghi chú.',
  'shop.note.full': [
    '*📝 Ghi chú sản phẩm — {name}*',
    '',
    '*Giá:* `{price} USDT`',
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
    '{refer_user} *Giới thiệu (24h):* {ref24h}\n' +
    '{refer_user} *Giới thiệu (7n):* {ref7d}\n' +
    '{refer_user} *Giới thiệu (Tổng):* {refTotal}\n\n' +
    '{refer_coin} *Tổng đã kiếm:* {earnedTotal} USDT\n' +
    '{refer_coin} *Khả dụng:* {available} USDT\n' +
    '{refer_transferred} *Đã chuyển:* {transferred} USDT\n' +
    '{refer_withdrawn} *Đã rút:* {withdrawn} USDT\n\n' +
    '> Kiếm 1% mỗi lần nạp của người bạn giới thiệu.\n' +
    '> Tối đa $1.00 mỗi lần nạp.\n' +
    '> Chuyển lợi nhuận vào ví bất kỳ lúc nào. Rút tiền mặt liên hệ hỗ trợ (tối thiểu $1.00).\n\n' +
    '*Liên kết giới thiệu của bạn:*\n`{link}`',
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
  'support.contact_prefill': 'Chào, tôi cần trợ giúp về ShopBot SafwanTiger. Vui lòng giúp tôi về: ',
  'support.btn.cancel': 'Hủy hỗ trợ',
  'support.btn.live': '🟢 Hỗ trợ trực tiếp',
  'support.btn.end_session': '🔴 Kết thúc phiên',
  'support.live.busy_popup':
    '⏳ Quản trị viên đang hỗ trợ người khác. Vui lòng thử lại sau ít phút.',
  'support.live.user_active':
    '{support_live_active} Hỗ trợ trực tiếp\n\n' +
    'Phiên hỗ trợ đang hoạt động.\n\n' +
    'Vui lòng nhắn tin cho chúng tôi qua thẻ Hỗ trợ trực tiếp được tạo phía trên trong cuộc trò chuyện này.',
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
