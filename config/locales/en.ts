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
  'btn.topup': '👛 Top-up Wallet',
  'btn.profile': '⚙️ Settings',
  'btn.support': '💬 Support',
  'btn.ai_support': '🥝 Kiwi Ai',
  'btn.back': '⬅️ Back',
  'btn.next': 'Next ▶️',
  'btn.prev': '◀️ Prev',
  'btn.refresh': '🔄 Refresh',
  'btn.buy_now': '✅ Buy Now',
  'btn.topup_wallet': '👛 Top-up Wallet',
  'btn.view_note': '📝 View Note',
  'btn.qty_plus': '➕',
  'btn.qty_minus': '➖',
  // Custom-quantity keypad — opens a numeric keypad in place of
  // the legacy +/- adder.
  'btn.custom_qty': '🔢 Custom Quantity',
  'btn.qty_keypad_back': '⌫',
  'btn.qty_keypad_clear': '🗑 Clear',
  'btn.qty_keypad_confirm': '✅ Confirm',
  // Buy-now payment-method screen.
  'btn.pay_wallet': '👛 Wallet',
  'btn.pay_direct': '💸 Pay Direct',
  'btn.pay_topup': '🪙 Top-up',
  // Wallet-confirm card (page 2 of the buy flow). The Confirm
  // button shows a green ✅ + premium tick, the Cancel button is
  // red with the same back-arrow as the rest of the bot.
  'btn.confirm_pay': '✅ Confirm',
  'btn.cancel_pay': '◀️ Cancel',
  // Payment-methods keyboard rows. Premium subscribers see the
  // animated icon defined in EMOJI.paymethod_others / paymethod_back;
  // everyone else gets the unicode prefix below as the natural
  // fallback. The leading emoji is stripped from the label at render
  // time when the icon is applied so the glyph never doubles up.
  'btn.paymethod_others': '💡 Others',
  'btn.paymethod_back': '◀️ Back',
  'btn.qty.max': '🎯 Max',
  'btn.qty.reset': '🔄 Reset',
  'btn.qty.confirm': '✅ Confirm',
  'btn.contact_admin': '💬 Contact Admin',
  // Inline-counter step buttons. Premium emojis are layered on at
  // render time (per-button icon override) — these unicode glyphs
  // are the fallback for clients without premium.
  'btn.qty.dec_1': '➖ 1',
  'btn.qty.dec_10': '⏪ 10',
  'btn.qty.dec_100': '⏮ 100',
  'btn.qty.inc_1': '➕ 1',
  'btn.qty.inc_10': '⏩ 10',
  'btn.qty.inc_100': '⏭ 100',
  'btn.qty.display': '📦 {qty} / {stock}',
  // Product-page extras.
  'btn.share_product': '🔗 Copy Link',
  // `btn.view_note_file` / `btn.send_note_txt` are kept for backwards
  // compat with /settext overrides; the new View Note screen no
  // longer surfaces a Save button.
  'btn.view_note_file': '📥 Save Note as TXT',
  'btn.send_note_txt': '📥 Save as TXT',
  // Out-of-stock products still show a Buy Now button labelled with
  // a premium ❌ glyph — tapping it surfaces the "contact admin to
  // restock" popup (see `shop.product.out_of_stock_popup`).
  'btn.out_of_stock': '❌ Buy Now',
  // Premium-shop overhaul (post-order tutorial CTA + Settings rows).
  'btn.using_method': '📘 Using Method',
  'btn.tutorial_open_link': '🔗 Open Link',
  'btn.bot_tutorial': '📘 Bot Tutorial',
  'btn.send_price_list': '📊 Send Price List',
  'btn.send_price_list.mail': '📤 Send on Mail',
  'btn.send_price_list.chat': '📬 Send in Chat',
  'btn.notify.email.on': '🟢 Email Reports: ON',
  'btn.notify.email.off': '🔕 Email Reports: OFF',
  // Post-purchase email follow-up CTAs.
  'btn.set_email_now': '📧 Add Verified Email',
  'btn.view_invoice': '🔗 View Invoice',
  'btn.my_orders': '🧾 My Orders',
  'btn.refer': '🎁 Refer',
  'btn.notifications': '🔔 Notifications',
  'btn.toggle_stock': '📢 Stock Alerts',
  'btn.toggle_announcements': '💬 Info Alerts',
  'btn.toggle_wallet': '💰 Wallet Alerts',
  // Each toggle now sits on its own full-width row — we can show
  // the full alert name and ON/OFF state.
  'btn.notify.stock.on': '🟢 Stock Alerts: ON',
  'btn.notify.stock.off': '🔕 Stock Alerts: OFF',
  'btn.notify.ann.on': '🟢 Info Alerts: ON',
  'btn.notify.ann.off': '🔕 Info Alerts: OFF',
  'btn.notify.wallet.on': '🟢 Wallet Alerts: ON',
  'btn.notify.wallet.off': '🔕 Wallet Alerts: OFF',
  'btn.back_to_settings': '⬅️ Back to Settings',
  // Same word in every locale so the inline keyboard layout stays
  // identical regardless of `lang` — the leading globe gets wrapped
  // as a premium emoji at render time.
  'btn.language': '🌐 Language',
  'btn.language.english': '🇬🇧 English',
  'btn.language.arabic': '🇸🇦 العربية',
  'btn.language.vietnamese': '🇻🇳 Tiếng Việt',
  'btn.region.clear': '🚫 Clear',
  'btn.deposit_history': '💳 My Deposits',
  'btn.channel': 'Channel',
  'btn.stats': '📊 Stats',
  'btn.stats_refresh': '🔄 Refresh',
  'btn.stats_back': '◀️ Back',
  'btn.set_region': '🗺 Set Region',
  'btn.set_email': '📧 Set Email',

  // ---------- Shop ----------
  // Shop home — single all-products list (categories step removed).
  // Header is a single bold line; pagination lives in the keyboard
  // footer (Prev / Refresh / Next / page indicator).
  'shop.home.header': '*Available Products:*',
  // Legacy key, kept for any callsite still on the old categories
  // flow.
  'shop.choose_category': '*Available Products:*',
  'shop.qty.prompt': '🔢 Type a quantity (1–{max}) and send.',
  'shop.qty.invalid': '❌ Invalid number — please send a value between 1 and {max}.',

  // ---- Custom-quantity keypad ---------------------------------
  // Short usage instruction appended below the product-page body
  // when the keypad is open. {current} is the digits the user has
  // tapped on the keypad so far — `—` until they've started.
  'shop.qty.keypad.instruction':
    '{qty_prompt_keypad} *How to use:* tap the digits below or send a number, ' +
    'then tap ✅ Confirm.\n' +
    'Current: <code>{current}</code>',
  // Premium-emoji error shown when the user enters an out-of-range
  // or non-numeric quantity. Auto-deletes a few seconds later so
  // it doesn't clutter the chat.
  'shop.qty.keypad.invalid':
    '{qty_invalid} *Invalid quantity.*\n\n' +
    'Please send a whole number between *1* and *{max}*.',

  // ---- Buy-now → payment method picker -------------------------
  // `{promo_line}` is filled in by the caller — either an empty
  // string (no active promo) or the localized "Promo:" line WITH
  // its own trailing newline so the layout stays tight.
  'shop.pay.title':
    '{pay_summary} *Order summary*\n\n' +
    '{emoji} *{name}*\n' +
    '{prod_qty_selected} Qty: *{qty}*\n' +
    '{promo_line}' +
    '{prod_total_amount} Total: *{total} USDT*\n' +
    '{prod_wallet} Wallet: *{balance} USDT*\n\n' +
    'Choose a pay method:',
  // Wallet-pay confirmation card (page 2). Short labels with
  // premium emojis on every line. `{discount_line}` is filled in
  // by the caller (empty string when there is no active discount).
  'shop.pay.confirm':
    '{prod_wallet} *Confirm Payment*\n\n' +
    '{pay_summary} *Order*\n' +
    '{emoji} *{name}* × *{qty}*\n' +
    '{discount_line}' +
    '{prod_total_amount} *Total:* {total} USDT\n' +
    '{prod_wallet} *Wallet:* {balance} USDT\n\n' +
    '_Charge *{total} USDT* from your wallet?_',
  // Optional discount row inside `shop.pay.confirm` — concatenated
  // by the caller when an active promo applies.
  'shop.pay.confirm.discount_line':
    '{prod_promo} *Discount:* −{discount} USDT\n',
  // Inline qty-editor screen body. Renders as a "big counter" with
  // the current selected qty in monospace, the product name, and
  // the running total cost.
  'shop.qty.editor.title':
    '🔢 *Select quantity*\n\n' +
    '*{name}*\n' +
    'In stock: *{stock}*\n' +
    'Unit price: *{price} USDT*\n\n' +
    'Selected: <code>{qty}</code>\n' +
    'Total: *{total} USDT*',
  'shop.empty_categories': 'No categories yet. Please check back later.',
  'shop.empty_products': 'No products in this category yet.',
  // Product detail page — premium emojis prefix every label per
  // bot-owner UX request. Each `{prod_*}` token resolves to a
  // `<tg-emoji>` tag with the configured custom_emoji_id (animated
  // for premium subs, plain unicode for everyone else).
  'shop.product.line.name': '{emoji} *{name}*',
  'shop.product.line.price': '{prod_price_base} *Price Base:* {price} USDT',
  // `{stock}` may render as either a number or the ∞ glyph (for
  // products with `unlimited_stock = true`).
  'shop.product.line.stock': '{prod_stock} *Available Stock:* {stock}',
  'shop.product.line.warranty': '{prod_warranty} *Warranty:* {warranty}',
  'shop.product.line.qty': '{prod_qty_selected} *Selected Qty:* {qty}',
  'shop.product.line.total': '{prod_total_amount} *Total Amount:* {total} USDT',
  'shop.product.line.balance': '{prod_wallet} *Wallet:* {balance} USDT',
  // Optional bonus line shown above Total Amount when an active
  // promo applies. `label` is either the admin-set promo name or
  // the auto-fallback "qty ≥ N".
  'shop.product.line.promo':
    '{prod_promo} *Promo:* {label} — −{discount} USDT',
  'shop.product.line.promo.fallback_label': 'qty ≥ {min_qty}',
  // Teaser line under Warranty when a promo exists for this product
  // but the buyer hasn't reached the qty threshold yet. Hidden once
  // the threshold is met (the strikethrough Total takes over).
  'shop.product.line.promo.teaser':
    '{prod_promo} *Promo:* Buy {min_qty}+ −${discount} Off',
  // Strikethrough Total Amount line shown when an active promo
  // applies — gross (struck) → effective price.
  'shop.product.line.total.discounted':
    '{prod_total_amount} *Total Amount:* ~~{gross}~~ {total} USDT',
  'shop.product.out_of_stock_popup':
    '❌ This product is out of stock right now. Please contact admin to restock or pick a similar item.',
  'shop.note.title': '{note_premium} *Product Note*',
  'shop.note.empty': '_The admin hasn’t added any notes for this product yet._',
  'shop.note.empty_description': '_No description provided._',
  // Premium View Note layout (pic 2 reference). Token names use
  // `note_premium` for the header glyph, `note_desc` for the
  // Description label and `note_text` for the Note label so the
  // admin can swap each premium emoji independently via
  // `/setemoji note_premium / note_desc / note_text`. Variables
  // (`description` / `note`) are substituted by `t()` BEFORE
  // `renderMdHtml` runs the premium-emoji pass — so a `{note}`
  // variable here would collide with the EMOJI key of the same name.
  'shop.note.full': [
    '{note_premium} *View Note — {name}*',
    '',
    '{note_desc} *Description:*',
    '> {description}',
    '',
    '{note_text} *Note:*',
    '> {note}',
  ].join('\n'),
  // Legacy single-message confirmation — still used by /settext
  // overrides and by the deposit credit reply. The new wallet-pay
  // delivery card uses the two-step `payment_verified` /
  // `order_delivered` keys below.
  'shop.buy.success':
    '✅ Purchase successful!\n\nProduct: *{name}*\nQty: *{qty}*\nTotal: *{total}*\n\nDelivery:\n```\n{delivery}\n```',
  // Step 1 of the premium delivery card (pic 3): Payment Verified!
  // Auto-deletes 15 seconds after being sent (handled in shop.ts).
  'shop.buy.payment_verified': [
    '{order_verified} *Payment Verified!*',
    '',
    '*Amount:* {total} USDT',
    '',
    '{delivering} _Delivering your order…_',
  ].join('\n'),
  // Step 2 of the premium delivery card (pic 3): Order Delivered!
  // The `{items}` slot is replaced in `shop.ts` with one `> line` per
  // claimed link / account so the renderer turns each into a Telegram
  // blockquote pill (matches the View Note "luli" / "Hey" look).
  'shop.buy.order_delivered': [
    '{order_delivered} *Order Delivered!*',
    '',
    '*Order ID#:* `{order_id}`',
    '*Product:* {name}',
    '*Quantity:* {qty}',
    '*Total Paid:* {total} USDT',
    '',
    '{delivered_items} *Items:*',
    '{items}',
  ].join('\n'),
  // Email follow-up #1: shown after Order Delivered when the buyer
  // has NO email on file. The `{email_add_l/r}` slots are left/right
  // premium-emoji bookends per the bot-owner spec.
  'shop.buy.add_email_prompt': [
    '{email_add_l} *Please For sending Product Invoices and good experience Add you Verified Email* {email_add_r}',
  ].join('\n'),
  // Email follow-up #2: shown after Order Delivered when the buyer
  // already has an email on file. Single bold line bookended by the
  // configured premium-emoji slots; auto-deletes ~13 s later (handled
  // in `shop.ts`).
  'shop.buy.invoice_sent':
    '{invoice_sent_l} *Product invoice sended to your mail* {invoice_sent_r}',
  // Confirmation shown immediately after a buyer adds their email via
  // the post-purchase `Add Verified Email` CTA. The other Email
  // Settings entries (typed-email message, "User Profile / Has been
  // Saved!" card) are auto-deleted from chat first — only this single
  // bold line remains.
  'shop.buy.email_setup_done':
    '{order_delivered} *Email has been setuped*',
  // Notification shown when an admin tops up a user's wallet via the
  // `/credit` flow. `{credit_emoji}` slots a premium credit-card glyph
  // and `{balance_emoji}` slots a premium wallet glyph so admins can
  // swap the icons via `/setemoji credit_emoji / balance_emoji`.
  'wallet.admin_credit':
    '{credit_emoji} admin credited *${amount}* to your wallet.\n{balance_emoji} New balance: *${balance}*',
  'wallet.admin_debit':
    '{debit_emoji} admin debited *${amount}* from your wallet.\n{balance_emoji} New balance: *${balance}*',
  'shop.buy.delivery_pending':
    'Coming soon — admin will deliver your items manually within 12h.',
  'shop.buy.insufficient':
    '❌ Insufficient wallet balance. You need *{need}* but only have *{have}*. Please top up first.',
  'shop.buy.no_stock': '❌ Sorry, this item is out of stock.',
  // Generic Wallet-Pay failure popup. Shown when something other
  // than INSUFFICIENT_FUNDS goes wrong (DB error, missing migration,
  // network) so the loading spinner is always dismissed.
  'shop.buy.failed':
    '❌ Payment could not be completed right now. Please try again in a moment, or contact admin if it keeps happening.',
  // Kept for backwards compat with any /settext overrides referencing
  // the old key, even though the email gate is no longer enforced.
  'shop.buy.email_required':
    'Setup email system first — we need your email to send the receipt.',

  // ---------- Using Method tutorial ----------
  // Per-product tutorial body shown when the buyer taps `📘 Using
  // Method` under an Order Delivered card.
  'shop.tutorial.body': [
    '{tutorial} *Using Method — {name}*',
    '',
    '{body}',
  ].join('\n'),
  'shop.tutorial.empty': [
    '{tutorial} *Using Method — {name}*',
    '',
    '_The admin hasn’t added a tutorial for this product yet. Please contact admin if you need help using your purchase._',
  ].join('\n'),
  'shop.page.header': '🛒 *{category}*\n\n*Available Products:*\n_{total} products — page {page}/{pages}_',

  // ---------- Profile ----------
  'profile.title': '*User Profile*',
  'profile.notifications.title': '{notify_bell} *Notifications*',
  'profile.notifications.body':
    '{notify_on} _Tune in only the alerts you love_ {notify_bell}\n\n' +
    '{notify_stock} *Stock Alerts*\n' +
    '{notify_info} *Info Alerts*\n' +
    '{notify_wallet} *Wallet Alerts*\n' +
    '{notify_email} *Email Reports*\n\n' +
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
  // Language picker screen — opened from Settings → Language.
  'profile.language.title': '{lang_left} *Select Language* {lang_right}',
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
  // 12-hour soft-nag reminder for users without a saved email. Sent
  // by `services/emailNag.ts` on the first interaction after every
  // 12-hour window. Users can mute this from Notifications →
  // Email Reports.
  'profile.email.nag': [
    '{email_nag} *Please Add Your Verified Email for More Secured Experience*',
    '',
    '_Tap *Settings → Email Settings → Set Email* to add yours._',
    '',
    '{email_thanks} _Thanks!_',
  ].join('\n'),
  // Popup error shown on the Send-PDF buttons when Email Reports is
  // OFF — gives the user the explicit unblock path.
  'profile.email.reports_off_popup':
    'Email Reports are turned OFF. Open Notifications → toggle "Email Reports: ON" first, then try again.',
  // Toast labels for the Email Reports toggle (mirrors the other
  // notification toggles' verbiage).
  'profile.notify.email_on': '🟢 Email Reports: ON',
  'profile.notify.email_off': '🔕 Email Reports: OFF',

  // ---------- Bot Tutorial (Settings) ----------
  // Admin-editable instructions screen (text + optional photo /
  // video / document attachment + optional URL button). Body is
  // reused verbatim from the `bot_tutorial.text` setting; the
  // header / footer wrap it in premium emojis.
  'profile.bot_tutorial.title': '{bot_tutorial} *Using Method — Bot*',
  'profile.bot_tutorial.empty':
    '_The admin hasn\u2019t added a bot tutorial yet. Please check back later._',
  'profile.bot_tutorial.body': '{body}',

  // ---------- Send Price List (Settings) ----------
  // Two-button picker. After picking a destination the user gets a
  // CSV with name / status / price / promo info. The mail variant
  // pipes the same CSV through `mailer.ts`; the chat variant sends
  // a Telegram document reply.
  'profile.pricelist.title': '{price_list} *Send Price List*',
  'profile.pricelist.body':
    '{price_list} _Choose where to send the live price-list CSV._\n\n' +
    '\u2022 *Send on Mail* \u2014 we\u2019ll email it to your saved address.\n' +
    '\u2022 *Send in Chat* \u2014 we\u2019ll attach it here as a downloadable file.',
  'profile.pricelist.no_email_popup':
    'Set your email first \u2014 open Settings \u2192 Email Settings \u2192 Set Email.',
  'profile.pricelist.empty':
    'No products in the catalog yet \u2014 ask the admin to add some.',
  'profile.pricelist.sending':
    '\u23f3 Building your price list\u2026',
  'profile.pricelist.mail_sent':
    '{pdf_sent_l} *Price list mailed!* Check your inbox at `{email}`.',
  'profile.pricelist.mail_failed':
    '\u274c Failed to email the price list. Please try again later.',
  'profile.pricelist.chat_sent':
    '{pdf_sent_r} *Price list ready \u2014 see the CSV above.*',
  // CSV header rows + status labels used by `services/csvReport.ts`.
  'profile.pricelist.csv.col.name': 'Product',
  'profile.pricelist.csv.col.price': 'Price (USDT)',
  'profile.pricelist.csv.col.status': 'Status',
  'profile.pricelist.csv.col.stock': 'Stock',
  'profile.pricelist.csv.col.promo': 'Promo',
  'profile.pricelist.csv.status.in_stock': 'In Stock',
  'profile.pricelist.csv.status.out_of_stock': 'Out of Stock',
  'profile.pricelist.csv.status.upcoming': 'Upcoming',
  'profile.pricelist.csv.promo_none': '\u2014',
  'profile.pricelist.csv.promo_format': 'Buy {min_qty}+ \u2212{discount} USDT',
  'profile.pricelist.csv.unlimited': '\u221e',
  // PDF (mail-only) — title / section header used by buildPriceListPdf.
  'profile.pricelist.pdf.title': 'SafwanTiger Shop \u2014 Price List',
  'profile.pricelist.pdf.section': 'Catalog',
  // Footer surfaced both in the CSV body and in the email subject /
  // body. Admin can override the marketing copy via /settext
  // `profile.pricelist.promo_footer`.
  'profile.pricelist.promo_footer':
    'Thanks for choosing SafwanTiger Shop. Tap the bot to redeem promos and earn referral rewards. \ud83d\udc2f',
  // Email Settings hub (the new submenu opened from a single Settings button).
  'profile.email.hub.title': '{email_bracket_l} *Email Settings* {profile_email}',
  'profile.email.hub.body':
    '{email_invoice} We use your email for purchase receipts and account-recovery only — never for marketing.\n\n' +
    '{profile_email} *Current email:* `{current}`',
  // Mobile popup shown when the user taps "Change Email" without one.
  'profile.email.change.no_email_popup': 'Please Set up email first',
  // Mobile popup shown when the user taps "Set Email" but already has one.
  'profile.email.set.already_set_popup':
    'Email has already been set ({current}). Use Change Email or Delete Email to update it.',
  // Mobile popup shown when the user taps "Delete Email" without one.
  'profile.email.delete.no_email_popup': 'No email is set yet — nothing to delete.',
  // Delete Email confirmation screen.
  'profile.email.delete.title': '{email_bracket_l} *Delete Email* {email_bracket_l}',
  'profile.email.delete.body':
    '{email_invalid} _Please confirm to delete email_\n\n' +
    '{profile_email} *Current email:* `{current}`',
  // Toast shown after the email is removed.
  'profile.email.delete.success': '✅ Email removed.',
  // Shown when another user already has this email.
  'profile.email.in_use':
    '{email_in_use} Email already in *use*\n\n' +
    '{email_arrow} *_Please enter a new verified email_*',
  // Buttons used on the Settings screen + email sub-screens.
  'btn.email.settings': '📧 Email Settings',
  'btn.email.change': '✏️ Change Email',
  'btn.email.set': '📧 Set Email',
  'btn.email.why': '❔ Why Email',
  'btn.email.delete': '🗑 Delete Email',
  'btn.email.delete.confirm': '🗑 Confirm Delete',
  'btn.email.delete.cancel': '⬅️ Cancel',
  'btn.email.know_more': '📄 Know More',
  // Send-PDF buttons (My Orders / My Deposits / My Stats screens).
  'btn.send_pdf.orders': 'Send Orders PDF to Email',
  'btn.send_pdf.deposits': '📤 Send Deposits PDF to Email',
  'btn.send_pdf.stats': '📤 Send Stats PDF to Email',
  // Pop-ups for the Send-PDF buttons.
  'pdf.no_email_popup':
    '⚠️ Set your email first. Open Settings → Email Settings → Set Email to add one, then come back and tap Send PDF.',
  'pdf.sending_popup': '⏳ Generating your PDF and sending it to {email}…',
  'pdf.sent_popup': '✅ PDF sent to {email}. Check your inbox (and spam folder).',
  // Chat-message ribbon shown right after a Send-PDF tap succeeds.
  // Uses the premium 📬 emoji so the success lands as a custom-emoji
  // entity rather than a plain toast.
  'pdf.sent_message': '{pdf_sent_l} *Pdf has been sended to mail* {pdf_sent_r}',
  'pdf.failed_popup':
    '❌ Could not send PDF to {email}. Please try again in a moment — if it keeps failing, contact support.',
  // My Deposits button.
  'btn.my_deposits': '💳 My Deposits',
  // Redeem Gift Code button (Settings) + screen.
  'btn.redeem': '🎁 Gift Code',
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
  'orders.empty':
    '{orders_title} *My Orders*\n\n' +
    '🪄 No orders yet.\n\n' +
    '✨ 🛍️ 🚀 Start shopping and your orders will appear here!',
  'orders.page': 'Page {page}/{pages}',
  'orders.status.active': 'Active',
  'orders.status.refunded': 'Refunded',
  'orders.status.cancelled': 'Cancelled',
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
  'orders.detail.received': '*Received:* {orders_received}\n\n{received}',
  'orders.detail.no_warranty': 'Non',
  'orders.detail.type.wallet': 'Wallet balance',
  'orders.detail.type.direct': 'Direct payment',
  // Buttons used on the Order detail screen.
  'btn.orders_back_list': 'Back to Orders',
  'btn.orders_open_link': 'Open Link',
  // Find by Order ID — opens a typed-input flow for a public order id.
  'btn.find_order_by_id': '🔍 Find by Order ID',
  // Prompt + error responses for the Find by Order ID flow. Custom
  // emoji ids resolve to premium glyphs at render time.
  'orders.lookup.prompt':
    '{order_id_find_l} *Send Your Order ID to find.* {order_id_find_r}',
  'orders.lookup.invalid':
    '{gift_invalid} That doesn\'t look like a valid Order ID. {order_id_invalid_r}',
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
  'topup.title': '👛 *Top Up Wallet*',
  'topup.choose_method': '👛 *Top Up Wallet*',
  'topup.empty_methods': 'No payment methods configured. Please contact support.',
  'topup.method.body': '*{name}*\n\n{instructions}',
  'topup.requested':
    '✅ Topup request submitted (#{id}).\nAdmin will verify and credit your wallet shortly.',

  // ---------- Support ----------
  'support.title': '{support_title} Support',
  'support.body':
    '_*If you\'re unable to send a message or have an issue, use Live Support to connect directly with an admin.*_',
  'support.btn.contact': '📩 Contact Admin',
  // Pre-filled into the admin DM's input bar when the user taps
  // Contact Admin (via t.me/<admin>?text=...).
  'support.contact_prefill': 'Hi i need help about ShopBot SafwanTiger Please Help me about : ',
  'support.btn.cancel': 'Cancel Support',
  'support.btn.live': '🟢 Live Support',
  'support.btn.end_session': '🔴 End Session',
  // Live-Support relay copy.
  'support.live.busy_popup':
    '⏳ The admin is currently helping another user. Please try again in a moment.',
  'support.live.user_active':
    '{support_live_active} Live Support\n\n' +
    'Support session active.\n\n' +
    'Please message us via the Live Support tab created above in this chat.',
  // Small status line edited into the original Support screen so chat
  // history shows when each session was opened.
  'support.live.session_created': '🟢 *Live Support session created*',
  'support.live.admin_started':
    '🟢 *Live Support started*\n\n' +
    'User: *{name}* (@{username})\nID: `{id}`\n\nReply here to chat with them. Send /end to close.',
  // No [Admin] tag on the user-facing side — the relay just forwards
  // the admin's raw text or media so it reads like a normal chat.
  'support.live.admin_relay': '*[{name}]:* {text}',
  'support.live.admin_media_header': '*[{name}]* sent media:',
  'support.live.user_ended':
    '{support_live_closed} Live Support closed.\n\n' +
    'Open Support again from the menu whenever you need help.',
  'support.live.admin_ended': '🔴 *Live Support session closed.*',
  // "Send chat PDF to email" follow-up under the closure message.
  'support.btn.email_transcript': '📧 Send chat PDF to email',
  // Reuses pdf_sent_l / pdf_sent_r so the success copy renders the
  // same animated frame the user sees after Send-PDF on My Orders.
  'support.transcript.sent_message':
    '{pdf_sent_l} *Pdf has been sended to mail* {pdf_sent_r}',
  'support.transcript.no_email_popup':
    '⚠️ Set your email first. Open Settings → Email Settings → Set Email to add one, then come back and tap Send chat PDF to email.',
  'support.transcript.sending_popup':
    '⏳ Generating your support transcript and sending it to {email}…',
  'support.transcript.failed_popup':
    '❌ Could not send the transcript to {email}. Please try again — if it keeps failing, contact support.',
  'support.transcript.expired_popup':
    '⌛ This transcript is no longer available. Start a new Live Support session whenever you need help.',
  // Kiwi AI — premium-formatted greeting. The kiwi avatar (`kiwi_ai`)
  // prefixes the headline so premium viewers see the animated kiwi
  // glyph and everyone else gets the unicode kiwi fallback. The
  // greeting is multi-turn: tap any number of questions, then
  // Cancel to close and (optionally) email the transcript.
  'support.ai.session_open':
    '{kiwi_ai} *Kiwi Ai*\n' +
    '*I am Kiwi automated support assistant.*\n\n' +
    'You can ask normal questions in any language or get help with ' +
    'products, pricing, stock, deposits, coupons, orders, and ' +
    'delivery. Internal system details are off-limits.',
  // Closure message shown when the user taps Cancel. Mirrors
  // `support.live.user_ended` so the two flows feel identical.
  'support.ai.user_ended':
    '{support_live_closed} Kiwi Ai chat closed.\n\n' +
    'Open Kiwi Ai again from the menu whenever you need help.',
  'support.ai.fallback':
    'I couldn\'t answer that automatically. A human will reach out shortly.',
  // Tiny prompt sent right after the AI chat is wiped on Cancel,
  // attached to the “📧 Send chat PDF to email” button so the user
  // can still save the conversation if they want to.
  'support.ai.pdf_prompt':
    '{kiwi_ai} *Kiwi Ai chat saved.*\n' +
    'Tap below to email the transcript as a PDF.',
  'support.ai.empty_popup':
    '💬 Send at least one question first — there\'s nothing to save yet.',
  // Legacy keys kept for any code path still referencing them.
  'support.ai.title': '{kiwi_ai} *Kiwi Ai*',
  'support.ai.prompt': 'Describe your issue and I\'ll do my best to help.',

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
