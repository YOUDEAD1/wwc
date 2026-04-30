/* English (default) — edit text here. */
export const en: Record<string, string> = {
  // ---------- Welcome / menu ----------
  'welcome': 'Welcome to SafwanTiger Shop',
  'welcome.title': 'Welcome to SafwanTiger Shop!',
  'welcome.balance': 'Your balance: *${balance}*',
  'welcome.tap_menu': 'Tap *Main Menu* below to begin.',
  'menu.title': '🐯 *SafwanTiger Shop* — Main Menu',

  // ---------- Buttons ----------
  'btn.main_menu': '⬅️ Main Menu',
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
  'btn.toggle_stock': '📦 Stock Alerts',
  'btn.toggle_announcements': '📣 Announcements',
  'btn.notify.stock.on': '📦 Stock Alert: ON',
  'btn.notify.stock.off': '📦 Stock Alert: OFF',
  'btn.notify.ann.on': '📣 Announcements: ON',
  'btn.notify.ann.off': '📣 Announcements: OFF',
  'btn.back_to_settings': '⬅️ Back to Settings',
  'btn.language': '🌐 Language',
  'btn.deposit_history': '💳 Deposit History',
  'btn.clear_cache': '🧹 Clear Cache',
  'btn.channel': '📢 Channel',

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
  'shop.page.header': '🛒 *{category}* — page {page}',

  // ---------- Profile ----------
  'profile.title': '⚙️ *Settings*',
  'profile.notifications.title': '🔔 *Notifications*',
  'profile.notifications.body':
    'Choose which alerts you want to receive. Tap a toggle to switch it on or off.',
  'profile.user_id': 'User ID: `{id}`',
  'profile.username': 'Username: @{username}',
  'profile.balance': '👛 Balance: *{balance}*',
  'profile.language': '🌐 Language: *{language}*',
  'profile.joined': '📅 Joined: *{joined}*',
  'profile.refer.title': '🎁 *Refer*',
  'profile.refer.body':
    'Share your referral link with friends:\n\n`{link}`\n\nYou\'ve referred *{count}* user(s) so far.',
  'profile.orders.empty': 'You have no orders yet.',
  'profile.orders.title': '🧾 *My Orders*',
  'profile.orders.line': '#{id} • {name} ×{qty} • {total} • {date}',
  'profile.notify.stock_on': 'Stock alerts: ✅ ON',
  'profile.notify.stock_off': 'Stock alerts: ⛔ OFF',
  'profile.notify.ann_on': 'Announcements: ✅ ON',
  'profile.notify.ann_off': 'Announcements: ⛔ OFF',
  'profile.deposits.title': '💳 *Deposit History*',
  'profile.deposits.empty': 'No deposits yet.',
  'profile.deposits.line': '#{id} • {amount} • {method} • {status} • {date}',

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
  'cache.cleared.user': '🧹 Cleared {count} old message(s). Claimed products are kept.',
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
