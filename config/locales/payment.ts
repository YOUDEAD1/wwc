export const paymentLocales = {
  en: {
    'payment.topup.binance':
      '💳 *Binance Pay Deposit*\n\n*Pay ID:* \x60{address}\x60\n*Name:* {name}\n\nSend USDT to this Pay ID, then send your *Order ID* below. Only incoming successful transfers started after opening this screen and completed within 30 minutes are verified.',
    'payment.topup.bybit':
      '💳 *Bybit Deposit*\n\n*Bybit UID:* \x60{address}\x60\n*Name:* {name}\n\nSend USDT inside Bybit to this UID, then send your *internal transfer TXID* below. Only incoming successful transfers started after opening this screen and completed within 30 minutes are verified.',
    'payment.chain':
      '💳 *{method}*\n\n*Send exactly:* \x60{amount} USDT\x60\n*Address:* \x60{address}\x60\n\nThis amount is reserved for your session. Send the exact amount using the selected USDT network, then paste the *TXID* here. The payment must be made after opening this screen and within 30 minutes. Do not send native TON or TRX for an exact USDT quote.',
    'payment.direct': '🛒 *{product} × {qty}*\n*Total:* {total} USDT\n\n{instructions}',
    'payment.ask_amount':
      '💳 *{method}*\n\n{instructions}\n\n*How much would you like to deposit?*\nSend an amount in USD, for example \x6050\x60 or \x60100.50\x60.',
    'payment.default_instructions':
      'Use this payment method and keep your payment receipt for verification.',
    'payment.invalid_amount':
      '❌ Invalid amount. Send a positive number with at most two decimal places.',
    'payment.minimum': '❌ The minimum deposit is {minimum} USDT.',
    'payment.submitted':
      '✅ Deposit submitted for admin review.\nOrder: #{id}\nAmount: {amount} USDT',
    'payment.ltc':
      '💳 *Litecoin Deposit*\n\n*Send exactly:* \x60{amount} LTC\x60\n*Address:* \x60{address}\x60\nValue: {usd} USD\nLocked rate: {rate} USD/LTC\nQuote expires in 10 minutes. Send this exact amount, then paste the LTC TXID here.',
    'referral.confirmed_notice':
      '🎁 *New verified referral!*\nUser: {user}\nAvailable referrals: {count}',
    'fsub.join': '📢 Join channel {number}',
    'fsub.check': '✅ I joined — check',
    'fsub.required': '⛔ Join the required channels, then tap the verification button.',
  },
  ar: {
    'payment.topup.binance':
      '💳 *إيداع Binance Pay*\n\n*آيدي Binance:* \x60{address}\x60\n*الاسم:* {name}\n\nأرسل USDT إلى هذا الآيدي ثم أرسل *رقم الطلب Order ID* هنا. يُتحقق من التحويلات الواردة الناجحة التي بدأت بعد فتح الشاشة واكتملت خلال 30 دقيقة.',
    'payment.topup.bybit':
      '💳 *إيداع Bybit*\n\n*آيدي Bybit:* \x60{address}\x60\n*الاسم:* {name}\n\nأرسل USDT داخليًا في Bybit إلى هذا الآيدي ثم أرسل *TXID التحويل الداخلي* هنا. يُتحقق من التحويلات الواردة الناجحة بعد فتح الشاشة وخلال 30 دقيقة.',
    'payment.chain':
      '💳 *{method}*\n\n*أرسل بالضبط:* \x60{amount} USDT\x60\n*العنوان:* \x60{address}\x60\n\nهذا المبلغ محجوز لجلستك. أرسل المبلغ نفسه عبر شبكة USDT المحددة ثم أرسل *TXID* هنا. يجب أن يتم الدفع بعد فتح الشاشة وخلال 30 دقيقة. لا ترسل TON أو TRX بدل USDT لهذا الطلب.',
    'payment.direct': '🛒 *{product} × {qty}*\n*الإجمالي:* {total} USDT\n\n{instructions}',
    'payment.ask_amount':
      '💳 *{method}*\n\n{instructions}\n\n*كم تريد أن تودع؟*\nأرسل المبلغ بالدولار، مثل \x6050\x60 أو \x60100.50\x60.',
    'payment.default_instructions': 'استخدم وسيلة الدفع المحددة واحتفظ بإيصال الدفع للتحقق.',
    'payment.invalid_amount': '❌ مبلغ غير صالح. أرسل رقمًا موجبًا بمنزلتين عشريتين كحد أقصى.',
    'payment.minimum': '❌ الحد الأدنى للإيداع {minimum} USDT.',
    'payment.submitted':
      '✅ أُرسل الإيداع لمراجعة الأدمن.\nرقم الطلب: #{id}\nالمبلغ: {amount} USDT',
    'payment.ltc':
      '💳 *إيداع Litecoin*\n\n*أرسل بالضبط:* \x60{amount} LTC\x60\n*العنوان:* \x60{address}\x60\nالقيمة: {usd} دولار\nالسعر المثبت: {rate} دولار/LTC\nينتهي العرض خلال 10 دقائق. أرسل المبلغ نفسه ثم أرسل TXID لايتكوين هنا.',
    'referral.confirmed_notice':
      '🎁 *إحالة جديدة تم التحقق منها!*\nالمستخدم: {user}\nالإحالات المتاحة: {count}',
    'fsub.join': '📢 اشترك في القناة {number}',
    'fsub.check': '✅ اشتركت، تحقق الآن',
    'fsub.required': '⛔ اشترك في القنوات المطلوبة ثم اضغط زر التحقق.',
  },
  vi: {
    'payment.topup.binance':
      '💳 *Nạp Binance Pay*\n\n*Pay ID:* \x60{address}\x60\n*Tên:* {name}\n\nGửi USDT đến Pay ID này, sau đó gửi *Order ID*. Chỉ xác minh giao dịch nhận thành công sau khi mở màn hình và trong vòng 30 phút.',
    'payment.topup.bybit':
      '💳 *Nạp Bybit*\n\n*UID Bybit:* \x60{address}\x60\n*Tên:* {name}\n\nChuyển USDT nội bộ đến UID này, sau đó gửi *TXID chuyển khoản nội bộ*. Chỉ xác minh giao dịch nhận thành công sau khi mở màn hình và trong vòng 30 phút.',
    'payment.chain':
      '💳 *{method}*\n\n*Gửi chính xác:* \x60{amount} USDT\x60\n*Địa chỉ:* \x60{address}\x60\n\nSố tiền này được dành riêng cho phiên của bạn. Gửi đúng số tiền qua mạng USDT đã chọn rồi gửi *TXID*. Giao dịch phải thực hiện sau khi mở màn hình, trong vòng 30 phút. Không gửi TON hoặc TRX thay cho USDT.',
    'payment.direct': '🛒 *{product} × {qty}*\n*Tổng:* {total} USDT\n\n{instructions}',
    'payment.ask_amount':
      '💳 *{method}*\n\n{instructions}\n\n*Bạn muốn nạp bao nhiêu?*\nNhập số tiền USD, ví dụ \x6050\x60 hoặc \x60100.50\x60.',
    'payment.default_instructions':
      'Thanh toán bằng phương thức đã chọn và giữ lại biên lai để xác minh.',
    'payment.invalid_amount':
      '❌ Số tiền không hợp lệ. Nhập số dương với tối đa hai chữ số thập phân.',
    'payment.minimum': '❌ Số tiền nạp tối thiểu là {minimum} USDT.',
    'payment.submitted':
      '✅ Đã gửi yêu cầu để quản trị viên duyệt.\nĐơn: #{id}\nSố tiền: {amount} USDT',
    'payment.ltc':
      '💳 *Nạp Litecoin*\n\n*Gửi chính xác:* \x60{amount} LTC\x60\n*Địa chỉ:* \x60{address}\x60\nGiá trị: {usd} USD\nTỷ giá cố định: {rate} USD/LTC\nBáo giá hết hạn sau 10 phút. Gửi đúng số tiền rồi gửi TXID LTC.',
    'referral.confirmed_notice':
      '🎁 *Lượt giới thiệu mới đã xác minh!*\nNgười dùng: {user}\nLượt giới thiệu khả dụng: {count}',
    'fsub.join': '📢 Tham gia kênh {number}',
    'fsub.check': '✅ Đã tham gia — kiểm tra',
    'fsub.required': '⛔ Tham gia các kênh bắt buộc rồi nhấn nút xác minh.',
  },
};
