/* English (default) — edit text here. */
export const en: Record<string, string> = {
  // ---------- Welcome / menu ----------
  'welcome': 'Welcome to SafwanTiger Shop',
  'welcome.title': 'Welcome to SafwanTiger Shop!',
  'welcome.balance': 'Your balance: *${balance}*',
  'welcome.tap_menu': 'Tap *Main Menu* below to begin.',
  'menu.title': '🐯 *SafwanTiger Shop* — Main Menu',

  // ---------- Buttons ----------
  'btn.main_menu': '⬅️ Back',
  'btn.shop': '🛍 Shop',
  'btn.topup': '🪙 Topup',
  'btn.profile': '⚙️ Settings',
  'btn.support': '💬 Support',
  'btn.ai_support': '🤖 AI Support',
  'btn.back': '⬅️ Back',
  'btn.next': 'Next ▶️',
  'btn.prev': '◀️ Prev',
  'btn.refresh': '🔄 Refresh',
  'btn.buy_now': '✅ Buy Now',
  'btn.topup_wallet': '👛 Topup Wallet',
  'btn.view_note': '📝 View Note',
  'btn.qty_plus': '➕',
  'btn.qty_minus': '➖',
  'btn.out_of_stock': '❌ Out of Stock',
  'btn.my_orders': '🧾 My Orders',
  'btn.refer': '🎁 Refer',
  'btn.notifications': '🔔 Notifications',
  'btn.toggle_stock': '📢 Stock Alerts',
  'btn.toggle_announcements': '💬 Info Alerts',
  'btn.toggle_wallet': '💰 Wallet Alerts',
  // Notification toggle buttons — kept short so all three fit on a
  // single inline-keyboard row, just like the Email Settings hub.
  'btn.notify.stock.on': '🟢 Stock',
  'btn.notify.stock.off': '🔕 Stock',
  'btn.notify.ann.on': '🟢 Info',
  'btn.notify.ann.off': '🔕 Info',
  'btn.notify.wallet.on': '🟢 Wallet',
  'btn.notify.wallet.off': '🔕 Wallet',
  'btn.back_to_settings': '⬅️ Back to Settings',
  // Multi-language label so users see their own language regardless of which
  // locale is currently active. Premium emoji ID 5310249748903504323 wraps
  // the leading globe.
  'btn.language': '🌐 Language / اللغة / Ngôn ngữ',
  'btn.deposit_history': '💳 My Deposits',
  'btn.channel': '📢 Channel',
  'btn.stats': '📊 Stats',
  'btn.stats_refresh': '🔄 Refresh',
  'btn.stats_back': '◀️ Back',
  'btn.set_region': '🗺 Set Region',
  'btn.set_email': '📧 Set Email',

  // ---------- Shop ----------
  'shop.choose_category': '🛒 *Shop* — choose a category:',
  'shop.empty_categories': 'No categories yet. Please check back later.',
  'shop.empty_products': 'No products in this category yet.',
  'shop.product.line.name': '*{name}*',
  'shop.product.line.price': '💰 Price: *{price}*',
  'shop.product.line.stock': '📦 Stock: *{stock}*',
  'shop.product.line.warranty': '🛡️ Warranty: {warranty}',
  'shop.product.line.qty': '🔢 Selected qty: *{qty}*',
  'shop.product.line.total': '🧮 Total: *{total}*',
  'shop.product.line.balance': '👛 Wallet: *{balance}*',
  'shop.note.title': '📝 *Product note*',
  'shop.note.empty': 'No note for this product.',
  'shop.buy.success':
    '✅ Purchase successful!\n\nProduct: *{name}*\nQty: *{qty}*\nTotal: *{total}*\n\nDelivery:\n```\n{delivery}\n```',
  'shop.buy.insufficient':
    '❌ Insufficient wallet balance. You need *{need}* but only have *{have}*. Please topup first.',
  'shop.buy.no_stock': '❌ Sorry, this item is out of stock.',
  'shop.buy.email_required':
    'Setup email system first — we need your email to send the receipt.',
  'shop.page.header': '🛒 *{category}* — page {page}',

  // ---------- Profile ----------
  'profile.title': '*User Profile*',
  'profile.notifications.title': '{notify_bell} *Notifications*',
  'profile.notifications.body':
    '{notify_stock} *Stock Alerts*\n' +
    '{notify_info} *Info Alerts*\n' +
    '{notify_wallet} *Wallet Alerts*\n\n' +
    '{notify_on} ON\n' +
    '{notify_off} OFF',
  'profile.row.id': 'ID: `{id}`',
  'profile.row.first_name': 'First Name: *{name}*',
  'profile.row.first_name_empty': 'First Name: _not set_',
  'profile.row.username': 'Username: @{username}',
  'profile.row.username_empty': 'Username: _not set_',
  'profile.row.link': 'User link: [open]({link})',
  'profile.row.status': 'Status: *{status}*',
  'profile.row.email': 'Email: `{email}` — Has been Saved! {email_saved_check}',
  'profile.row.email_empty': 'Email: _not set_ — tap *Set Email* below',
  'profile.row.balance': 'Balance: *{balance} USDT*',
  'profile.row.language': 'Language: *{language}*',
  'profile.row.region': 'Region: *{region}* — local time *{time}*',
  'profile.row.region_empty': 'Region: _not set_ — tap *Set Region*',
  'profile.row.joined': 'Joined: *{joined}*',
  // Legacy keys (kept for any callers referencing them via /settext)
  'profile.user_id': 'ID: `{id}`',
  'profile.username': 'Username: @{username}',
  'profile.balance': 'Balance: *{balance}*',
  'profile.language': 'Language: *{language}*',
  'profile.joined': 'Joined: *{joined}*',
  'profile.status.default': 'started bot',
  'profile.region.title': '🗺 *Set Region*',
  'profile.region.body':
    'Pick your country — your local time will then be used in messages and timestamps.',
  'profile.region.saved': '✅ Region set to *{region}*. Local time: *{time}*.',
  // Set Email screen (no email yet).
  'profile.email.set.title': '{email_bracket_l} *Set Email* {profile_email}',
  'profile.email.set.body':
    'Enter Below {email_arrow} *Your Email*\n\nEmail: `example@mail.com` {email_saved_check}',
  // Change Email screen (email already set).
  'profile.email.change.title': '{email_bracket_l} *Change Email* {email_bracket_r}',
  'profile.email.change.body':
    'Current Email {profile_email}: `{current}`\n\nEnter Below {email_arrow} *Your New Email*:\nExample: `Example@Email.Com` {email_saved_check}',
  // Why Email screen.
  'profile.email.why.title': '{email_bracket_l} *We Need Your Email* {profile_email}',
  'profile.email.why.body':
    '{email_saved_check} We need your email to send invoices {email_invoice} and to keep our services secure {email_secure} — thanks {email_thanks}.',
  // Misc.
  'profile.email.saved': '✅ Email saved: `{email}`',
  'profile.email.bad': '{email_invalid} *Please Enter A Valid Email*',
  // Email Settings hub (the new submenu opened from a single Settings button).
  'profile.email.hub.title': '{email_bracket_l} *Email Settings* {profile_email}',
  'profile.email.hub.body': 'Email: {current}',
  // Mobile popup shown when the user taps "Change Email" without one.
  'profile.email.change.no_email_popup': 'Please Set up email first',
  // Buttons used on the Settings screen + email sub-screens.
  'btn.email.settings': '📧 Email Settings',
  'btn.email.change': '✏️ Change',
  'btn.email.set': '📧 Set',
  'btn.email.why': '❔ Why Email',
  'btn.email.know_more': '📄 Know More',
  // My Deposits button.
  'btn.my_deposits': '💳 My Deposits',
  // Redeem Gift Code button (Settings) + screen.
  'btn.redeem': '🎁 Redeem Gift Code',
  'btn.buy_code': '🛒 Buy Code',
  // ---------- Redeem Gift Code screen ----------
  'gift.title': '{gift_title} *Redeem Gift Code*',
  'gift.body':
    '{gift_send} Send your gift code below to credit USDT {gift_usdt} to your wallet.\n\n' +
    '{gift_balance} *Current Balance:* {balance} USDT\n\n' +
    '_Each gift code can be redeemed only once per user (unless owner sets a higher limit)._',
  'gift.expired': '{gift_expired} This gift code has expired.',
  'gift.invalid': '{gift_invalid} This gift code is invalid.',
  'gift.already_used': '{gift_expired} You have already redeemed this code.',
  'gift.exhausted': '{gift_expired} This gift code is no longer available.',
  'gift.redeemed':
    '{gift_redeemed} Gift code has been redeemed successfully — *{amount} USDT* has been credited.',
  // ---------- My Orders screen ----------
  'orders.title': '{orders_title} *My Orders*',
  'orders.body': 'Tap any order below to open details, or send the public Order ID shown in your receipt.',
  'orders.empty': 'You haven\'t placed any orders yet.',
  'orders.page': 'Page {page}/{pages}',
  'orders.status.active': '🛡 Active',
  'orders.status.refunded': '↩️ Refunded',
  'orders.status.cancelled': '⛔ Cancelled',
  // Order detail screen.
  'orders.detail.title': '{orders_title} *My Orders*',
  'orders.detail.id': '{orders_id} *Order ID#* : `{id}`',
  'orders.detail.product': '{orders_product} *Product:* {name}',
  'orders.detail.type': '{orders_type} *Type:* {type}',
  'orders.detail.qty': '{orders_qty} *Selected Qty:* {qty}',
  'orders.detail.total': '{orders_total} *Total Amount:* {total} USDT',
  'orders.detail.when': '{orders_when} *When:* {when}',
  'orders.detail.status': '{orders_status} *Status:* {status}',
  'orders.detail.paid': '{orders_type} *Paid:* {paid}',
  'orders.detail.delivered': '{orders_status} *Delivered:* {delivered}',
  'orders.detail.note': '*Product Note* {orders_note}\n{note}',
  'orders.detail.warranty': '*Warranty:* {warranty} {orders_warranty}',
  'orders.detail.received': '*Received:* {orders_received}\n{received}',
  'orders.detail.no_warranty': 'Non',
  'orders.detail.type.wallet': 'Wallet balance',
  'orders.detail.type.direct': 'Direct payment',
  // Buttons used on the Order detail screen.
  'btn.orders_back_list': '⬅️ Back to Orders',
  'btn.orders_open_link': '🔗 Open Link',
  // Legacy keys kept so anything still calling them won't break.
  'profile.email.title': '📧 *Set Email*',
  'profile.email.body':
    'Send your contact email — replies and receipts will use this address.\n\nOr `/cancel`.',
  // Refer & Earn screen.
  'profile.refer.title': '{refer_title} *Refer & Earn*',
  'profile.refer.body':
    '{refer_user} *Referred (24h):* {ref24h}\n' +
    '{refer_user} *Referred (7d):* {ref7d}\n' +
    '{refer_user} *Referred (Total):* {refTotal}\n\n' +
    '{refer_coin} *Total Earned:* {earnedTotal} USDT\n' +
    '{refer_coin} *Available:* {available} USDT\n' +
    '{refer_transferred} *Transferred:* {transferred} USDT\n' +
    '{refer_withdrawn} *Withdrawn:* {withdrawn} USDT\n\n' +
    '> Earn 1% of every top-up by your referred users.\n' +
    '> Max $1.00 per top-up.\n' +
    '> Transfer earnings to wallet anytime. For cash withdrawal, contact support ($1.00 min).\n\n' +
    '*Your Referral Link:*\n`{link}`',
  'btn.copy_link': '📋 Copy Link',
  'profile.orders.empty': 'You have no orders yet.',
  'profile.orders.title': '🧾 *My Orders*',
  'profile.orders.line': '#{id} • {name} ×{qty} • {total} • {date}',
  'profile.notify.stock_on': 'Stock Alerts: ✅ ON',
  'profile.notify.stock_off': 'Stock Alerts: ⛔ OFF',
  'profile.notify.ann_on': 'Info Alerts: ✅ ON',
  'profile.notify.ann_off': 'Info Alerts: ⛔ OFF',
  'profile.notify.wallet_on': 'Wallet Alerts: ✅ ON',
  'profile.notify.wallet_off': 'Wallet Alerts: ⛔ OFF',
  'profile.notify.error':
    '⚠️ Could not save your toggle — apply migration `0008_wallet_alert.sql` on the database.',
  // ---------- My Deposits screen (rewritten) ----------
  'profile.deposits.title': '{deposits_title} *My Deposits*',
  'profile.deposits.empty': '{email_bracket_l} No deposits yet. {email_bracket_l}',
  'profile.deposits.payments_header': '*Payment Deposits* {deposits_payments}',
  'profile.deposits.wallet_header': '*Wallet Balance History* {deposits_wallet}',
  'profile.deposits.line.id': '*#{n}*',
  'profile.deposits.line.amount': 'Amount: {amount} USDT',
  'profile.deposits.line.method': 'Method: {method}',
  'profile.deposits.line.status': 'Status: {status}',
  'profile.deposits.line.reference': 'Reference: `{reference}`',
  'profile.deposits.line.when': 'When: {when}',
  'profile.deposits.wallet.line.type': 'Type: {type}',
  'profile.deposits.wallet.line.amount': 'Amount: {sign}{amount} USDT',
  'profile.deposits.wallet.line.reference': 'Reference: `{reference}`',
  'profile.deposits.wallet.line.when': 'When: {when}',
  // Wallet ledger type labels.
  'profile.deposits.wallet.type.wallet_purchase': 'Wallet purchase',
  'profile.deposits.wallet.type.deposit_credit': 'Deposit credit',
  'profile.deposits.wallet.type.admin_add_balance': 'Admin added balance',
  'profile.deposits.wallet.type.admin_deduct_balance': 'Admin deducted balance',
  // Status labels (deposit row).
  'profile.deposits.status.pending': 'pending_review',
  'profile.deposits.status.approved': 'Credited',
  'profile.deposits.status.rejected': 'failed',

  'profile.stats.title': 'Your Stats',
  'profile.stats.orders': 'Orders: {count}',
  'profile.stats.items': 'Items Bought: {count}',
  'profile.stats.spent': 'Total Spent: {amount} USDT',
  'profile.stats.last': 'Last Order: {rel} ({abs})',
  'profile.stats.last_none': 'Last Order: —',
  'profile.stats.deposits': 'Deposits: {amount} USDT',
  'profile.stats.rel.now': 'just now',
  'profile.stats.rel.minutes': '{n}m ago',
  'profile.stats.rel.hours': '{n}h ago',
  'profile.stats.rel.days': '{n}d ago',

  // ---------- Topup ----------
  'topup.title': '👛 *Topup Wallet*',
  'topup.choose_method': 'Choose a payment method:',
  'topup.empty_methods': 'No payment methods configured. Please contact support.',
  'topup.method.body': '*{name}*\n\n{instructions}\n\nMin amount: *{min}*',
  'topup.requested':
    '✅ Topup request submitted (#{id}).\nAdmin will verify and credit your wallet shortly.',

  // ---------- Support ----------
  'support.title': '💬 *Support*',
  'support.body':
    'Need help? Contact our team: @safwantiger\nOr describe your issue and we\'ll get back to you.',
  'support.ai.title': '🤖 *Automated Support Assistant*',
  'support.ai.prompt': 'Describe your issue and I\'ll do my best to help.',
  'support.ai.fallback':
    'I couldn\'t answer that automatically. A human will reach out shortly.',

  // ---------- Channel ----------
  'channel.not_set': '📢 The channel link hasn\'t been set yet. Ask the admin to configure it.',
  'channel.subscribe.title': '📢 *Join our channel* to continue',
  'channel.subscribe.body': 'Please join the channel below, then tap *I joined*.',
  'channel.subscribe.joined': '✅ I joined',

  // ---------- Admin ----------
  'admin.only': '⛔ Admin only.',
  'admin.help.title': '🛠 *Admin Commands*',
  'admin.cache.cleared': '🧹 Cache cleared.',

  'admin.text.set': '✅ Text `{key}` updated.',
  'admin.color.set': '✅ Color for `{key}` set to *{color}*.',
  'admin.emoji.set': '✅ Emoji `{key}` updated.',
  'admin.product.added': '✅ Product *{name}* added (id={id}).',
  'admin.category.added': '✅ Category *{name}* added (id={id}).',
  'admin.payment.added': '✅ Payment method *{name}* added (id={id}).',
  'admin.bad_args': '❌ Bad arguments. Usage: `{usage}`',

  // ---------- Errors ----------
  'err.generic': '⚠️ Something went wrong. Please try again.',
  'err.unknown_action': '⚠️ Unknown action.',
};
