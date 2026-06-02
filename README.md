# 🐯 SafwanTiger Shop Bot

Futuristic Telegram shop bot for **@safwantigershopbot** — built with
**Node.js + TypeScript + grammY + Supabase**, deployable on **Railway**.

- Config-driven UI (every label, color, and emoji lives in one place)
- Admin commands to edit texts, button colors, and premium emojis at runtime
- Multi-language (English, Arabic, Vietnamese)
- Wallet-based shop (categories → products → buy from balance)
- Topup, Deposit history, Orders, Referrals, Notifications toggles
- Optional automated support assistant (OpenAI)

> **The repo never contains real secrets.** Configure them in `.env` (local)
> or your Railway service variables (production).

---

## 1. Project Structure

```
SafwanTigerShopBot/
├── README.md
├── package.json
├── tsconfig.json
├── .env.example                # copy to .env
├── Procfile                    # Railway / Heroku-style worker
├── railway.toml                # Railway config-as-code
├── eslint.config.js
├── .prettierrc
├── supabase/
│   └── migrations/
│       └── 0001_init.sql       # full schema + seed
├── config/                     #  ✨  edit-here-first  ✨
│   ├── index.ts                # buttons, colors, emojis, layout, paging
│   └── locales/
│       ├── en.ts               # English (default)
│       ├── ar.ts               # Arabic
│       └── vi.ts               # Vietnamese
└── src/
    ├── index.ts                # entrypoint (polling | webhook)
    ├── bot.ts                  # wiring: middleware + handlers
    ├── env.ts                  # env validation (zod)
    ├── logger.ts
    ├── types.ts
    ├── db/
    │   ├── supabase.ts         # supabase-js client
    │   └── queries.ts          # all SQL access
    ├── i18n/
    │   └── index.ts            # t(lang, key, vars)
    ├── middleware/
    │   ├── session.ts          # in-memory session (qty per product)
    │   ├── user.ts             # auto-create + attach ctx.user / ctx.t
    │   └── adminOnly.ts
    ├── keyboards/              # reply + inline keyboard builders
    │   ├── helpers.ts          # btn() / colored() with state colors
    │   ├── mainMenu.ts
    │   ├── shop.ts
    │   └── profile.ts
    ├── services/
    │   ├── settings.ts         # admin-editable runtime config cache
    │   ├── cache.ts            # in-mem KV cache (Clear Cache button)
    │   ├── wallet.ts
    │   └── premium.ts          # premium-emoji entity rendering
    └── handlers/
        ├── start.ts            # /start, /menu
        ├── shop.ts             # categories, products, qty, buy
        ├── profile.ts          # profile, orders, refer, lang, notify
        ├── support.ts          # human + AI support
        ├── topup.ts            # payment methods + deposit creation
        └── admin/
            └── index.ts        # /admin, /settext, /setcolor, /setemoji,
                                # /addcategory, /addproduct, /addpayment,
                                # /announce, /clearcache, /reload
```

### Where to edit common things

| What                           | File                                             |
| ------------------------------ | ------------------------------------------------ |
| Welcome message / button text  | `config/locales/en.ts` (and `ar.ts`, `vi.ts`)    |
| Button color / state color     | `config/index.ts` → `DEFAULT_BUTTON_COLORS`      |
| Default emojis (premium-aware) | `config/index.ts` → `EMOJI`                      |
| Main menu layout               | `config/index.ts` → `MAIN_MENU_LAYOUT`           |
| Page size                      | `config/index.ts` → `PRODUCTS_PER_PAGE`          |
| Database schema                | `supabase/migrations/0001_init.sql`              |

**Anything in `config/` can also be overridden at runtime** by the admin
through bot commands (e.g. `/settext welcome Hello!`,
`/setcolor shop green`, `/setemoji fire 🔥 5440123…`). Runtime overrides
live in the `settings` table and take precedence over the file values.

---

## 2. Prerequisites

- **Node.js ≥ 20**, npm ≥ 10
- A **Supabase** project (Free tier works) — https://supabase.com
- A **Telegram bot token** from [@BotFather](https://t.me/BotFather)
- A **Railway** account (or any platform that runs Node) — https://railway.app

---

## 3. Local Setup

```bash
git clone https://github.com/safwandeveloper/SafwanTigerShopBot.git
cd SafwanTigerShopBot
cp .env.example .env
# edit .env with your real BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, …

npm install
npm run dev          # tsx watch — restarts on save
```

Build & run the compiled output:

```bash
npm run build
npm start
```

Type-check & lint:

```bash
npm run typecheck
npm run lint
```

---

## 4. Manual Setup — Telegram (BotFather)

1. Open [@BotFather](https://t.me/BotFather) and run `/newbot`.
2. Choose a display name and a username ending in `bot`
   (e.g. `safwantigershopbot`).
3. **Copy the token** — paste it into `BOT_TOKEN` in `.env` (or Railway).
4. Set the bot username (without `@`) into `BOT_USERNAME`.
5. *(Optional but recommended)* Run `/setprivacy → Disable` so the bot can
   read group messages, and `/setjoingroups → Enable` if you want it in groups.
6. *(Optional)* Run `/setcommands` and paste:

   ```
   start - Open the main menu
   menu - Show the main menu
   admin - Admin commands (admin only)
   ```

   The bot also calls `setMyCommands` on startup — this step is just for
   discovery in clients that haven't refreshed.
7. *(For Telegram Premium emojis)* Find a premium emoji pack you like and
   copy its `custom_emoji_id`s (they appear in the message as
   `tg://emoji?id=…`). Then run inside your bot:
   `/setemoji fire 🔥 5440123412341234567`.
8. **Enable Threaded Mode** so Live Support can spawn its own chat
   tab. Open [@BotFather](https://t.me/BotFather), pick this bot,
   then **Bot Settings → Configure → Threaded Mode → Enable**. Once
   on, every user's DM with the bot becomes a forum-style chat with
   topic tabs at the top, and the Live Support button creates /
   deletes a dedicated `Live Support` topic for each session (matching
   the `Cancel Support` pinned panel + tab UX). If Threaded Mode
   isn't available or stays off, Live Support silently falls back to
   the legacy single-pinned-panel relay.
9. **Disable user-created topics** so the bot is the only thing that
   ever spawns a topic. In the same @BotFather Mini App page where
   Threaded Mode lives, turn **Users can create topics** (a.k.a.
   `allows_users_to_create_topics`) **OFF**. Without this, every
   plain message a user types in their main "New Chat" tab is
   silently turned by Telegram into a brand-new topic named after
   that message (e.g. typing `hi` makes a `hi` thread), and the
   `New Thread — Type any message to create a new thread.` overlay
   appears as the empty-state of the main tab. The bot also has a
   runtime safety net that auto-deletes any user-created topic, but
   flipping this BotFather toggle off is what removes the overlay
   itself.

---

## 5. Manual Setup — Supabase

1. Create a new project at <https://supabase.com>.
2. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ keep secret
3. Open the **SQL Editor** and run the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

   Or, with the Supabase CLI:

   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   ```
4. The migration seeds the admin row for user ID `8004955979`
   (`@safwantiger`). To add more admins later:

   ```sql
   insert into public.admins (telegram_id, username) values (123456, 'someone');
   ```

5. *(Optional)* Seed a category and product to play with:

   ```sql
   insert into public.categories (name, emoji) values ('Demo', '🎁');
   insert into public.products (category_id, name, price, stock, warranty)
   values (1, 'Sample Product', 9.99, 100, '7 days');
   insert into public.payment_methods (name, instructions, min_amount)
   values ('USDT (TRC20)', 'Send to T...wallet, then click ✅', 5);
   ```

---

## 6. Deploy to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub** → pick this repo.
3. Railway auto-detects Node and runs `npm ci && npm run build`,
   then `node dist/index.js` (see `railway.toml`).
4. **Variables** tab — add every value from `.env.example`. At minimum:

   | Variable                       | Value                                          |
   | ------------------------------ | ---------------------------------------------- |
   | `BOT_TOKEN`                    | from BotFather                                 |
   | `BOT_USERNAME`                 | `safwantigershopbot`                           |
   | `ADMIN_USER_ID`                | `8004955979`                                   |
   | `SUPABASE_URL`                 | `https://xxx.supabase.co`                      |
   | `SUPABASE_SERVICE_ROLE_KEY`    | the **service_role** JWT                       |
   | `BOT_MODE`                     | `polling` (recommended)                        |
   | `DEFAULT_LANG`                 | `en`                                           |
   | `LOG_LEVEL`                    | `info`                                         |

5. *(Optional)* For webhook mode on Railway, enable a public domain in
   the service settings, then set:

   ```
   BOT_MODE=webhook
   WEBHOOK_URL=https://<your-app>.up.railway.app
   WEBHOOK_SECRET=<random_long_string>
   PORT=3000
   ```

   Railway will route external traffic to `PORT` automatically.
6. Trigger a deploy. The `worker` defined in the `Procfile` will start.

### Binance Pay VPN Sidecar (Required for Auto-Verify)

If you're using Binance Pay auto-verify and seeing `HTTP 451` errors, you need to route traffic through a VPN. Here's how to set it up on Railway:

#### Step 1: Add VPN Config File

Add the WireGuard VPN config file (`Binance_Config-NL-FREE-2.conf`) to your Railway project as a private service.

#### Step 2: Create VPN Sidecar Service in Railway

1. Go to Railway Dashboard → Your project
2. Click **Add a Service** → **Private Service**
3. Name it: `vpn-sidecar`
4. Use Nixpacks with this Nix expression:

```nix
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [ wireguard-tools ];
  shellHook = ''
    wg-quick up wg0 2>/dev/null || echo "VPN starting..."
  '';
}
```

5. Mount your WireGuard config file
6. Set startup command: `wg-quick up wg0 && sleep infinity`

#### Step 3: Connect Bot to VPN

1. In your bot service, add a Nixpacks configuration to route traffic:
2. Or use a SOCKS proxy through the VPN sidecar

#### Alternative: Use ProtonVPN Business (Easier)

1. Buy ProtonVPN Business
2. Get dedicated Netherlands IP
3. Configure your Railway service to use it

#### Testing VPN Connection

```bash
# SSH into your server (if using VPS)
curl -I https://api.binance.com

# If you see HTTP 451, VPN is not working
# If you see HTTP 200 or other, VPN is working
```

### Alternative platforms

The bot has no platform-specific code. Anywhere that runs `node dist/index.js`
will work: **Fly.io**, **Render**, **VPS + pm2**, or **Docker**:

```dockerfile
# Dockerfile (sample)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
CMD ["node", "dist/index.js"]
```

---

## 7. Admin Cheat-Sheet

Send these from the admin Telegram account (must be in the `admins` table):

| Command                                  | Effect                                   |
| ---------------------------------------- | ---------------------------------------- |
| `/admin`                                 | Show full help                           |
| `/settext <key> <text…>`                 | Override any i18n string                 |
| `/setbutton <key> <text…>`               | Override a button label (`btn.<key>`)    |
| `/setcolor <key> <blue\|green\|red\|yellow\|none>` | Change a button color prefix |
| `/setemoji <key> <unicode> [custom_id]`  | Map a key to a (premium) emoji           |
| `/addcategory <name> [emoji]`            | Create a category                        |
| `/addproduct <cat_id> <price> <stock> <name…>` | Create a product                   |
| `/addpayment Name \| Instructions \| min` | Create a payment method                  |
| `/announce <text…>`                      | Broadcast (premium-emoji aware)          |
| `/clearcache`                            | Drop in-memory caches                    |
| `/reload`                                | Re-read settings table                   |

Examples:

```
/settext welcome 🐯 Welcome back to SafwanTiger Shop!
/setcolor buy_now green
/setemoji fire 🔥 5440123412341234567
/addcategory Streaming 🎬
/addproduct 1 9.99 50 Netflix Premium 1m
/addpayment USDT TRC20 | Send to TXxxxx... then click ✅ | 5
/announce 🔥 New stock added! Check the shop now.
```

---

## 8. About Inline-Button "Colors"

The Telegram **Bot API does not expose a per-button color property**.
What looks like coloured buttons in some bots is actually a unicode prefix
trick: a coloured square emoji (🟦🟥🟩🟨) at the start of the label.

This bot does the same, fully driven by config:

- `DEFAULT_BUTTON_COLORS` in `config/index.ts` controls every button's
  default color.
- Out-of-stock products are automatically rendered with the
  `out_of_stock` color (red by default).
- The admin can change any color at runtime with `/setcolor`.

---

## 9. About Premium Emojis

Telegram allows bots to attach `custom_emoji` `MessageEntity`s referencing
emoji IDs from premium packs. Premium subscribers see the animated/styled
glyph; non-premium users see the unicode fallback.

`src/services/premium.ts` renders templates like `Hi {fire}!` into a text
+ entities pair. Map keys like `fire` to a `{ unicode, custom_emoji_id }`
pair via:

```
/setemoji fire 🔥 5440123412341234567
```

`/announce` automatically uses this rendering pipeline.

---

## 10. Roadmap / Out-of-Scope

These are intentionally left as straightforward extensions:

- Approval UI for pending deposits (currently auto-pending; admin can
  flip status via SQL or extend `/topup` admin commands)
- Persistent session in Postgres / Redis (currently in-memory)
- Webhook signature verification for Supabase webhooks → realtime stock alerts
- Multi-step admin conversations (use `@grammyjs/conversations` —
  already in deps)

PRs welcome.

---

## License

MIT
