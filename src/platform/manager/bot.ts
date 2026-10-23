import { Bot, InputFile, type Context } from 'grammy';
import { randomUUID } from 'node:crypto';
import type { Registry } from '../repository.js';
import type { WorkerPool } from '../pool.js';
import { PlatformError, safeSupabaseUrl } from '../security.js';
import { tenantWebhookSecret } from '../../tenants/security.js';
import { entitiesToHtml } from './format.js';
import { walletPrice } from '../pricing.js';
import { managerFetch } from '../../services/telegramFetch.js';
import {
  ManagerContent,
  catalog,
  entries,
  languages,
  languageNames,
  placeholders,
  escapeHtml,
  validateCopy,
  type Language,
} from './content.js';
import { ManagerProfiles, type Profile, type Draft } from './profiles.js';
import { NssBridge, type WalletCheckout } from './nss.js';
type Execute = (
  action: string,
  actor: number,
  body?: Record<string, any>,
  origin?: 'manager' | 'bridge',
) => Promise<{ status: number; body: Record<string, any> }>;
type Target = { key: string; data?: string; url?: string; vars?: Record<string, unknown> };
export class StoreManager {
  readonly bot: Bot;
  readonly profiles: ManagerProfiles;
  readonly nss: NssBridge;
  private seen = new Map<number, number>();
  private pending = new Map<number, Promise<void>>();
  private users = new Map<number, Promise<void>>();
  private rates = new Map<number, { until: number; count: number }>();
  constructor(
    readonly registry: Registry,
    readonly pool: WorkerPool,
    readonly execute: Execute,
    readonly content: ManagerContent,
    options: { bot?: Bot; profiles?: ManagerProfiles; nss?: NssBridge } = {},
  ) {
    this.bot =
      options.bot ??
      new Bot(registry.config.managerToken, {
        client: { timeoutSeconds: 15, fetch: managerFetch },
      });
    this.profiles = options.profiles ?? new ManagerProfiles(registry);
    this.nss = options.nss ?? new NssBridge(registry.config);
    this.bot.on(['message', 'callback_query'], (ctx) => this.dispatch(ctx));
  }
  root(uid: number) {
    return this.registry.config.owners.includes(uid);
  }
  async initialize() {
    await this.bot.init();
    if (
      this.bot.botInfo.username?.toLowerCase() !==
      this.registry.config.managerUsername.toLowerCase()
    )
      throw Error('WWC_MANAGER_USERNAME does not match its token');
    await this.bot.api.setWebhook(this.registry.config.publicUrl + '/webhook/manager', {
      secret_token: tenantWebhookSecret(this.registry.config.managerToken),
      max_connections: 8,
      drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query'],
    });
    await this.content.load();
    await Promise.all([
      this.bot.api.setMyCommands(this.commands('en')),
      ...languages.map((lang) =>
        this.bot.api.setMyCommands(this.commands(lang), { language_code: lang }),
      ),
    ]);
  }
  private commands(lang: Language) {
    return [
      ['start', 'home'],
      ['stores', 'shops'],
      ['help', 'guide'],
      ['settings', 'settings'],
      ['cancel', 'cancel'],
    ].map(([command, key]) => ({
      command: command!,
      description: this.content.raw(lang, key!).slice(0, 256),
    }));
  }
  async handle(update: any) {
    if (!Number.isSafeInteger(update.update_id)) throw new PlatformError(400, 'INVALID_UPDATE');
    if ((this.seen.get(update.update_id) ?? 0) > Date.now()) return;
    if (this.pending.has(update.update_id)) return this.pending.get(update.update_id)!;
    if (this.pending.size >= 64) throw new PlatformError(503, 'MANAGER_BUSY');
    const uid = update.message?.from?.id ?? update.callback_query?.from?.id ?? 0;
    const task = (this.users.get(uid) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.bot.handleUpdate(update))
      .then(() => {
        this.seen.set(update.update_id, Date.now() + 300000);
        if (this.seen.size > 2000) this.seen.delete(this.seen.keys().next().value!);
      })
      .finally(() => {
        this.pending.delete(update.update_id);
        if (this.users.get(uid) === task) this.users.delete(uid);
      });
    this.pending.set(update.update_id, task);
    this.users.set(uid, task);
    return task;
  }
  private t(p: Profile, key: string, vars: Record<string, unknown> = {}) {
    return this.content.text(p.language, key, vars);
  }
  private async show(
    ctx: Context,
    p: Profile,
    key: string,
    rows: Target[][] = [],
    vars: Record<string, unknown> = {},
  ) {
    return this.showHtml(ctx, this.t(p, key, vars), this.keyboard(p, rows));
  }
  private keyboard(p: Profile, rows: Target[][]) {
    return {
      inline_keyboard: rows.map((row) =>
        row.map((b) =>
          this.content.button(
            p.language,
            b.key,
            b.url ?? b.data ?? 'm:home',
            b.vars ?? {},
            !!b.url,
          ),
        ),
      ),
    } as any;
  }
  private async showHtml(ctx: Context, text: string, reply_markup: any) {
    const opts = {
      parse_mode: 'HTML' as const,
      reply_markup,
      link_preview_options: { is_disabled: true },
    };
    if (ctx.callbackQuery?.message) {
      try {
        return await ctx.editMessageText(text, opts);
      } catch (e: any) {
        if (e?.description?.includes('message is not modified')) return;
      }
    }
    return ctx.reply(text, opts);
  }
  private nav(): Target[][] {
    return [[{ key: 'home', data: 'm:home' }]];
  }
  private async call(action: string, p: Profile, data: Record<string, any> = {}) {
    return (await this.execute(action, p.telegram_id, data, 'manager')).body;
  }
  async home(ctx: Context, p: Profile) {
    const rows: Target[][] = [
      [{ key: 'create', data: 'm:create' }],
      [
        { key: 'shops', data: 'm:shops:0' },
        { key: 'plans', data: 'm:plans' },
      ],
      [
        { key: 'guide', data: 'm:guide' },
        { key: 'settings', data: 'm:settings' },
      ],
    ];
    if (this.root(p.telegram_id)) rows.push([{ key: 'super', data: 'm:super' }]);
    return this.show(ctx, p, 'welcome', rows, { name: ctx.from?.first_name ?? '✦' });
  }
  private async chooseLanguage(ctx: Context, p: Profile) {
    const kb = {
      inline_keyboard: languages.map((lang) => [
        { text: languageNames[lang], callback_data: 'm:lang:' + lang },
      ]),
    };
    return this.showHtml(ctx, this.t(p, 'choose_language'), kb);
  }
  private async list(ctx: Context, p: Profile, all = false, offset = 0) {
    if (all && !this.root(p.telegram_id)) throw new PlatformError(403, 'FORBIDDEN');
    const result = await this.call('list', p, { all, offset });
    const rows: Target[][] = result.shops.map((s: any) => [
      {
        key: 'store_item',
        data: 'm:dash:' + s.id,
        vars: {
          status: this.content.raw(p.language, 'state_' + s.status),
          bot: s.bot_username,
          plan: this.content.raw(p.language, s.plan),
        },
      },
    ]);
    const pages: Target[] = [];
    if (offset > 0)
      pages.push({
        key: 'previous',
        data: `m:${all ? 'all' : 'shops'}:${Math.max(0, offset - 50)}`,
      });
    if (result.next_offset !== null)
      pages.push({ key: 'next', data: `m:${all ? 'all' : 'shops'}:${result.next_offset}` });
    if (pages.length) rows.push(pages);
    rows.push([{ key: 'create', data: 'm:create' }], ...this.nav());
    return this.show(ctx, p, result.shops.length ? 'list_title' : 'no_shops', rows);
  }
  private async dashboard(ctx: Context, p: Profile, id: string) {
    const { shop, stats: s } = await this.call('dashboard', p, { shop_id: id });
    const num = (v: any) => (v == null ? '—' : String(v)),
      none = this.content.raw(p.language, 'none');
    const ready =
      s.available === false ? 'unverified' : !s.working ? 'not_running' : s.warm ? 'ready' : 'cold';
    const rows: Target[][] = [
      [{ key: 'open_bot', url: shop.bot_url }],
      [{ key: 'subscribe', data: 'm:sub:' + id }],
      [
        {
          key: shop.status === 'active' ? 'pause' : shop.status === 'setup' ? 'activate' : 'resume',
          data:
            shop.status === 'setup'
              ? 'm:act:' + id
              : `m:confirm:${shop.status === 'active' ? 'pause' : 'resume'}:${id}`,
        },
      ],
      [
        { key: 'sql', data: 'm:sql:' + id },
        { key: 'refresh', data: 'm:dash:' + id },
      ],
    ];
    if (shop.owner_id === p.telegram_id)
      rows.push([{ key: 'credentials', data: 'm:credentials:' + id }]);
    if (this.root(p.telegram_id))
      rows.push([
        { key: 'unlock', data: 'm:confirm:super_resume:' + id },
        { key: 'grant', data: 'm:confirm:grant:' + id },
      ]);
    rows.push([{ key: 'back', data: 'm:shops:0' }], ...this.nav());
    return this.show(ctx, p, 'dashboard', rows, {
      bot: shop.bot_username,
      status: this.content.raw(p.language, 'state_' + shop.status),
      plan: this.content.raw(p.language, shop.plan),
      users: num(s.users),
      orders: num(s.orders),
      revenue: num(s.revenue),
      profit: num(s.known_supplier_profit),
      runtime: this.content.raw(p.language, ready),
      until: shop.paid_until ?? none,
      strikes: shop.idle_strikes,
      customer: shop.last_customer_at ?? none,
      purchase: shop.last_purchase_at ?? none,
      note: this.content.raw(
        p.language,
        s.available === false ? 'stats_unavailable' : 'metrics_note',
      ),
    });
  }
  private async plans(ctx: Context, p: Profile) {
    const plan = await this.call('config', p);
    return this.show(
      ctx,
      p,
      'plans_body',
      [
        [
          { key: 'shops', data: 'm:shops:0' },
          { key: 'create', data: 'm:create' },
        ],
        ...this.nav(),
      ],
      {
        price: plan.wallet_price_usd ?? this.content.raw(p.language, 'price_disabled'),
        days: plan.days,
      },
    );
  }
  private nssLink() {
    return 'https://t.me/' + this.registry.config.nssUsername;
  }
  private async requireAccount(ctx: Context, p: Profile) {
    try {
      await this.nss.call('account', p.telegram_id);
      return true;
    } catch (e) {
      if (e instanceof PlatformError && e.code === 'NSS_ACCOUNT_REQUIRED') {
        await this.show(ctx, p, 'account_required', [
          [{ key: 'nss', url: this.nssLink() }],
          [{ key: 'refresh', data: 'm:begin' }],
          ...this.nav(),
        ]);
        return false;
      }
      throw e;
    }
  }
  private async begin(ctx: Context, p: Profile, replacement?: string) {
    if (!(await this.requireAccount(ctx, p))) return;
    if (replacement) {
      const r = await this.call('info', p, { shop_id: replacement });
      if (r.shop.owner_id !== p.telegram_id) throw new PlatformError(403, 'FORBIDDEN');
    }
    await this.profiles.setDraft(p, { step: 'token', replacement });
    return this.show(ctx, p, 'token_prompt', [[{ key: 'cancel', data: 'm:cancel' }]]);
  }
  private async sql(ctx: Context, p: Profile, id: string) {
    const { shop } = await this.call('info', p, { shop_id: id }),
      schema = await this.call('schema', p);
    await ctx.replyWithDocument(new InputFile(Buffer.from(schema.sql), 'WWC-STORE-SETUP.sql'));
    return this.show(
      ctx,
      p,
      'sql_ready',
      [
        [{ key: 'open_bot', url: shop.bot_url }],
        [{ key: 'activate', data: 'm:act:' + id }],
        [{ key: 'back', data: 'm:dash:' + id }],
      ],
      { bot: shop.bot_username },
    );
  }
  private async activate(ctx: Context, p: Profile, id: string) {
    const result = await this.call('activate', p, { shop_id: id });
    await this.show(ctx, p, result.queued ? 'queued' : 'active_done', [
      [{ key: 'shops', data: 'm:dash:' + id }],
      ...this.nav(),
    ]);
  }
  private async checkout(ctx: Context, p: Profile, q: WalletCheckout) {
    const back = [{ key: 'back', data: 'm:dash:' + q.shop_id }];
    if (q.state === 'applied') {
      return this.show(ctx, p, 'receipt', [back, ...this.nav()], {
        amount: q.amount,
        balance: q.balance_after ?? q.balance,
        reference: q.reference ?? q.token,
      });
    }
    if (['wallet_debiting', 'payment_received'].includes(q.state))
      return this.show(
        ctx,
        p,
        'payment_pending',
        [[{ key: 'refresh', data: 'm:status:' + q.token }], back],
        { reference: q.reference ?? q.token },
      );
    if (q.state !== 'wallet_quote' || q.expired)
      return this.show(ctx, p, 'payment_expired', [back, ...this.nav()]);
    const rows: Target[][] = [
      [{ key: 'pay', data: 'm:pay:' + q.token, vars: { amount: q.amount } }],
      [{ key: 'nss', url: this.nssLink() }],
      [{ key: 'cancel', data: 'm:cancelpay:' + q.token }],
      back,
    ];
    let text = this.t(p, 'quote', {
      bot: q.bot_username,
      days: q.days,
      amount: q.amount,
      balance: q.balance,
      expires: q.expires_at,
    });
    if (Number(q.balance) < Number(q.amount)) text += '\n\n' + this.t(p, 'insufficient');
    return this.showHtml(ctx, text, this.keyboard(p, rows));
  }
  private async superHome(ctx: Context, p: Profile) {
    if (!this.root(p.telegram_id)) throw new PlatformError(403, 'FORBIDDEN');
    const data = await this.registry.rpc<any>('wwc_manager_overview', {});
    return this.show(
      ctx,
      p,
      'super_body',
      [
        [{ key: 'all_shops', data: 'm:all:0' }],
        [
          { key: 'console', data: 'm:console' },
          { key: 'plan_config', data: 'm:policy' },
        ],
        ...this.nav(),
      ],
      {
        ...data,
        workers: this.pool.entries.size,
        worker_limit: this.registry.config.maxWorkers,
        queue: this.pool.queuedRequests,
        limit: this.registry.config.maxShops,
      },
    );
  }
  private async console(ctx: Context, p: Profile) {
    return this.show(ctx, p, 'console_body', [
      ...Array.from({ length: 6 }, (_, i) => [
        { key: 'folder_' + i, data: 'm:folder:' + i + ':0' },
      ]),
      [{ key: 'back', data: 'm:super' }],
    ]);
  }
  private async folder(ctx: Context, p: Profile, folder: number, page: number) {
    const keys = catalog.filter((e) => e.folder === folder);
    const list = keys.slice(page * 8, page * 8 + 8);
    const kb = this.keyboard(p, [[{ key: 'back', data: 'm:console' }]]);
    kb.inline_keyboard.unshift(
      ...list.map((e) => [
        {
          text:
            (e.button ? '🔘 ' : '📝 ') +
            this.content
              .raw(p.language, e.key)
              .replace(/<[^>]+>|\{[^}]+\}/g, '')
              .split('\n')[0]!
              .slice(0, 49),
          callback_data: 'm:entry:' + p.language + ':' + e.key,
        },
      ]),
    );
    const pages = [];
    if (page > 0)
      pages.push(this.content.button(p.language, 'previous', `m:folder:${folder}:${page - 1}`));
    if ((page + 1) * 8 < keys.length)
      pages.push(this.content.button(p.language, 'next', `m:folder:${folder}:${page + 1}`));
    if (pages.length) kb.inline_keyboard.splice(-1, 0, pages);
    return this.showHtml(ctx, this.t(p, 'folder_' + folder), kb);
  }
  private async entry(ctx: Context, p: Profile, lang: Language, key: string) {
    const e = entries.get(key);
    if (!e) throw new PlatformError(400, 'INVALID_COPY');
    const value = this.content.raw(lang, key);
    const rows: Target[][] = [
      [
        { key: 'edit', data: `m:edit:${lang}:${key}` },
        { key: 'preview', data: `m:preview:${lang}:${key}` },
      ],
    ];
    if (e.button)
      rows.push([
        { key: 'emoji', data: `m:emoji:${lang}:${key}` },
        { key: 'color', data: `m:color:${lang}:${key}` },
      ]);
    rows.push(
      [{ key: 'reset', data: `m:reset:${lang}:${key}` }],
      [{ key: 'back', data: 'm:folder:' + e.folder + ':0' }],
    );
    const kb = this.keyboard(p, rows);
    kb.inline_keyboard.unshift(
      languages.map((l) => ({ text: languageNames[l], callback_data: `m:entry:${l}:${key}` })),
    );
    return this.showHtml(
      ctx,
      this.t(p, 'entry_body', {
        title: key,
        language: languageNames[lang],
        value: value.length > 1600 ? value.slice(0, 1600) + '…' : value,
        fields:
          placeholders(e.values.en)
            .map((f) => '{' + f + '}')
            .join(' ') || '—',
      }),
      kb,
    );
  }
  private async policy(ctx: Context, p: Profile) {
    const { price, days } = this.content.policy();
    return this.show(
      ctx,
      p,
      'plan_config_body',
      [
        [
          { key: 'edit_price', data: 'm:policyedit:usd' },
          { key: 'edit_days', data: 'm:policyedit:days' },
        ],
        [{ key: 'back', data: 'm:super' }],
      ],
      { price: price ?? this.content.raw(p.language, 'price_disabled'), days },
    );
  }
  private async cmsAction(ctx: Context, p: Profile, parts: string[]) {
    if (!this.root(p.telegram_id)) throw new PlatformError(403, 'FORBIDDEN');
    const action = parts[1]!,
      lang = parts[2] as Language,
      key = parts[3]!;
    if (action === 'console') return this.console(ctx, p);
    if (action === 'folder')
      return this.folder(ctx, p, Number(parts[2]), Math.max(0, Number(parts[3]) || 0));
    if (action === 'policy') return this.policy(ctx, p);
    if (action === 'policyedit') {
      if (!['usd', 'days'].includes(parts[2]!)) throw new PlatformError(400, 'INVALID_COPY');
      await this.profiles.setDraft(p, { step: 'policy', setting: parts[2] });
      return this.show(ctx, p, 'policy_prompt', [[{ key: 'cancel', data: 'm:cancel' }]]);
    }
    if (action === 'save') {
      const d = this.profiles.draft(p);
      if (!d || !['copy_preview', 'emoji_preview', 'policy_preview'].includes(d.step))
        return this.show(ctx, p, 'expired', this.nav());
      if (d.step === 'copy_preview') {
        validateCopy(d.key, d.value);
        await this.content.set(`text.${d.lang}.manager.${d.key}`, d.value);
      } else if (d.step === 'emoji_preview')
        await this.content.set('btnicon.manager.' + d.key, d.icon);
      else await this.content.set('manager.plan.' + d.setting, d.value);
      await this.profiles.setDraft(p, null);
      await this.show(ctx, p, 'saved', this.nav());
      return d.step === 'policy_preview' ? this.policy(ctx, p) : this.entry(ctx, p, d.lang, d.key);
    }
    if (!languages.includes(lang) || !entries.has(key))
      throw new PlatformError(400, 'INVALID_COPY');
    if (action === 'entry') return this.entry(ctx, p, lang, key);
    if (action === 'preview') {
      const e = entries.get(key)!;
      const vars = Object.fromEntries(placeholders(e.values.en).map((f) => [f, '…']));
      const kb = this.keyboard(p, [[{ key: 'back', data: `m:entry:${lang}:${key}` }]]);
      if (e.button)
        kb.inline_keyboard.unshift([
          this.content.button(lang, key, `m:entry:${lang}:${key}`, vars),
        ]);
      return this.showHtml(
        ctx,
        e.button ? this.t(p, 'preview') : this.content.text(lang, key, vars),
        kb,
      );
    }
    if (action === 'reset') {
      await this.profiles.setDraft(p, {
        step: 'copy_preview',
        key,
        lang,
        value: entries.get(key)!.values[lang],
      });
      return this.show(
        ctx,
        p,
        'save_preview',
        [[{ key: 'confirm', data: 'm:save' }], [{ key: 'cancel', data: 'm:cancel' }]],
        { language: languageNames[lang], value: entries.get(key)!.values[lang] },
      );
    }
    if (action === 'edit' || action === 'emoji') {
      if (action === 'emoji' && !entries.get(key)!.button)
        throw new PlatformError(400, 'INVALID_COPY');
      await this.profiles.setDraft(p, { step: action === 'edit' ? 'copy' : 'emoji', key, lang });
      return this.show(
        ctx,
        p,
        action === 'edit' ? 'edit_prompt' : 'emoji_prompt',
        [[{ key: 'cancel', data: 'm:cancel' }]],
        {
          fields:
            placeholders(entries.get(key)!.values.en)
              .map((f) => '{' + f + '}')
              .join(' ') || '—',
        },
      );
    }
    if (action === 'color') {
      if (!entries.get(key)!.button) throw new PlatformError(400, 'INVALID_COPY');
      return this.show(ctx, p, 'color', [
        [
          { key: 'blue', data: `m:setcolor:${lang}:${key}:blue` },
          { key: 'green', data: `m:setcolor:${lang}:${key}:green` },
        ],
        [
          { key: 'red', data: `m:setcolor:${lang}:${key}:red` },
          { key: 'default_color', data: `m:setcolor:${lang}:${key}:none` },
        ],
        [{ key: 'back', data: `m:entry:${lang}:${key}` }],
      ]);
    }
    if (action === 'setcolor') {
      if (!entries.get(key)!.button || !['blue', 'green', 'red', 'none'].includes(parts[4]!))
        throw new PlatformError(400, 'INVALID_COPY');
      await this.content.set('color.manager.' + key, parts[4]);
      return this.entry(ctx, p, lang, key);
    }
    throw new PlatformError(400, 'INVALID_COPY');
  }
  private async input(ctx: Context, p: Profile, d: Draft) {
    const raw = ctx.message?.text;
    if (!raw) return this.show(ctx, p, 'invalid_copy', [[{ key: 'cancel', data: 'm:cancel' }]]);
    const text = raw.trim();
    if (['token', 'url', 'key'].includes(d.step)) await ctx.deleteMessage().catch(() => {});
    try {
      if (d.step === 'token') {
        if (
          !/^\d{6,15}:[A-Za-z0-9_-]{25,80}$/.test(text) ||
          text === this.registry.config.managerToken
        )
          throw new PlatformError(400, 'INVALID_BOT_TOKEN');
        await this.profiles.setDraft(p, { ...d, step: 'url', token: text });
        return this.show(ctx, p, 'url_prompt', [[{ key: 'cancel', data: 'm:cancel' }]]);
      }
      if (d.step === 'url') {
        const url = safeSupabaseUrl(text);
        if (url === this.registry.config.databaseUrl)
          throw new PlatformError(400, 'SEPARATE_STORE_DATABASE_REQUIRED');
        await this.profiles.setDraft(p, { ...d, step: 'key', url });
        return this.show(ctx, p, 'key_prompt', [[{ key: 'cancel', data: 'm:cancel' }]]);
      }
      if (d.step === 'key') {
        if (text.length < 30 || text.length > 4096 || text.startsWith('sb_publishable_'))
          throw new PlatformError(400, 'INVALID_CREDENTIALS');
        if (!text.startsWith('sb_secret_')) {
          let claims: any;
          try {
            claims = JSON.parse(Buffer.from(text.split('.')[1] ?? '', 'base64url').toString());
          } catch {}
          if (claims?.role !== 'service_role') throw new PlatformError(400, 'SERVER_KEY_REQUIRED');
        }
        const source = await this.nss.call('source', p.telegram_id);
        const result = await this.call('register', p, {
          bot_token: d.token,
          database_url: d.url,
          database_key: text,
          source_url: source.source_url,
          source_key: source.source_key,
          lang: p.language,
          replacement_id: d.replacement,
        });
        await this.profiles.setDraft(p, null);
        return this.sql(ctx, p, result.shop.id);
      }
      if (!this.root(p.telegram_id)) throw new PlatformError(403, 'FORBIDDEN');
      if (d.step === 'copy') {
        const e = entries.get(d.key)!;
        const value = e.button ? text : entitiesToHtml(raw, ctx.message?.entities ?? []);
        validateCopy(d.key, value);
        await this.profiles.setDraft(p, { ...d, step: 'copy_preview', value });
        const kb = this.keyboard(p, [
          [{ key: 'confirm', data: 'm:save' }],
          [{ key: 'cancel', data: 'm:cancel' }],
        ]);
        if (e.button)
          kb.inline_keyboard.unshift([
            { text: value, callback_data: 'm:entry:' + d.lang + ':' + d.key },
          ]);
        return this.showHtml(
          ctx,
          this.t(p, 'save_preview', {
            language: languageNames[d.lang as Language],
            value: e.button ? escapeHtml(value) : '',
          }) + (e.button ? '' : '\n' + value),
          kb,
        );
      }
      if (d.step === 'emoji') {
        const entity = ctx.message?.entities?.find((e) => e.type === 'custom_emoji');
        const icon =
          text === '0'
            ? {}
            : entity?.type === 'custom_emoji'
              ? {
                  unicode: raw.slice(entity.offset, entity.offset + entity.length),
                  custom_emoji_id: entity.custom_emoji_id,
                }
              : { unicode: text };
        if ((icon.unicode?.length ?? 0) > 16 || (icon.unicode && /[<>\n]/.test(icon.unicode)))
          throw new PlatformError(400, 'INVALID_COPY');
        await this.profiles.setDraft(p, { ...d, step: 'emoji_preview', icon });
        const label = this.content.raw(d.lang, d.key);
        const kb = this.keyboard(p, [
          [{ key: 'confirm', data: 'm:save' }],
          [{ key: 'cancel', data: 'm:cancel' }],
        ]);
        kb.inline_keyboard.unshift([
          {
            text: (icon.custom_emoji_id ? '' : (icon.unicode ?? '')) + ' ' + label,
            callback_data: 'm:entry:' + d.lang + ':' + d.key,
            ...(icon.custom_emoji_id ? { icon_custom_emoji_id: icon.custom_emoji_id } : {}),
          },
        ]);
        return this.showHtml(ctx, this.t(p, 'preview'), kb);
      }
      if (d.step === 'policy') {
        const value = d.setting === 'usd' ? (text === '0' ? '0' : walletPrice(text)) : Number(text);
        if (
          value === null ||
          (d.setting === 'days' &&
            (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 365))
        )
          throw new PlatformError(400, 'INVALID_COPY');
        await this.profiles.setDraft(p, { ...d, step: 'policy_preview', value });
        return this.show(
          ctx,
          p,
          'save_preview',
          [[{ key: 'confirm', data: 'm:save' }], [{ key: 'cancel', data: 'm:cancel' }]],
          { language: languageNames[p.language], value: String(value) },
        );
      }
      return this.show(ctx, p, 'expired', this.nav());
    } catch (e) {
      if (e instanceof PlatformError && e.status === 400)
        return this.show(ctx, p, 'invalid_copy', [[{ key: 'cancel', data: 'm:cancel' }]]);
      throw e;
    }
  }
  private async route(ctx: Context, p: Profile, target: string) {
    if (target === 'open')
      return this.show(ctx, p, 'setup_intro', [[{ key: 'begin', data: 'm:begin' }], ...this.nav()]);
    if (target.startsWith('wwcsub_')) {
      const result = await this.nss.call('wallet_quote', p.telegram_id, {
        shop_id: target.slice(7),
      });
      return this.checkout(ctx, p, result.checkout);
    }
    if (/^wwc_s_[a-f0-9]{24}$/.test(target)) return this.dashboard(ctx, p, target.slice(4));
    if (target === 'shops') return this.list(ctx, p);
    return this.home(ctx, p);
  }
  private async dispatch(ctx: Context) {
    if (!ctx.from) return;
    const uid = ctx.from.id;
    let p: Profile = { telegram_id: uid, language: 'en', language_chosen: false };
    try {
      await this.content.load();
      if (ctx.chat?.type !== 'private') return void (await this.show(ctx, p, 'private'));
      p = await this.profiles.get(uid);
      if (!languages.includes(p.language)) p.language = 'en';
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      let rate = this.rates.get(uid);
      if (!rate || rate.until < Date.now()) {
        rate = { until: Date.now() + 60000, count: 0 };
        this.rates.set(uid, rate);
      }
      if (this.rates.size > 2000) this.rates.delete(this.rates.keys().next().value!);
      if (++rate.count > 40) return void (await this.show(ctx, p, 'limited'));
      const text = ctx.message?.text ?? '',
        command = text.split(/\s/)[0]?.split('@')[0],
        data = ctx.callbackQuery?.data ?? '',
        parts = data.split(':');
      if (data.startsWith('m:lang:')) {
        const lang = parts[2] as Language;
        if (!languages.includes(lang)) return;
        p.language = lang;
        p.language_chosen = true;
        await this.bot.api
          .setMyCommands(this.commands(lang), { scope: { type: 'chat', chat_id: uid } })
          .catch(() => {});
        const draft = this.profiles.draft(p);
        await this.profiles.setDraft(p, null);
        return void (await this.route(ctx, p, draft?.step === 'entry' ? draft.target : ''));
      }
      if (!p.language_chosen) {
        if (command === '/start') {
          const target = text.split(/\s+/)[1] ?? '';
          if (target) await this.profiles.setDraft(p, { step: 'entry', target });
        }
        return void (await this.chooseLanguage(ctx, p));
      }
      if (command === '/start') {
        await this.profiles.setDraft(p, null);
        return void (await this.route(ctx, p, text.split(/\s+/)[1] ?? ''));
      }
      if (['/cancel', '/stores', '/help', '/settings', '/admin'].includes(command ?? '')) {
        await this.profiles.setDraft(p, null);
        if (command === '/cancel') return void (await this.show(ctx, p, 'cancelled', this.nav()));
        if (command === '/stores') return void (await this.list(ctx, p));
        if (command === '/help')
          return void (await this.show(ctx, p, 'guide_body', this.guideRows()));
        if (command === '/admin') return void (await this.superHome(ctx, p));
        return void (await this.show(
          ctx,
          p,
          'settings_body',
          [[{ key: 'language', data: 'm:language' }], ...this.nav()],
          { language: languageNames[p.language] },
        ));
      }
      if (ctx.message) {
        const draft = this.profiles.draft(p);
        if (draft) return void (await this.input(ctx, p, draft));
        return void (await this.home(ctx, p));
      }
      if (!data.startsWith('m:')) return;
      const action = parts[1]!;
      if (
        [
          'home',
          'cancel',
          'shops',
          'all',
          'guide',
          'settings',
          'plans',
          'console',
          'super',
          'create',
          'language',
          'folder',
          'entry',
          'preview',
          'policy',
          'dash',
          'sql',
          'act',
          'sub',
          'help',
        ].includes(action)
      )
        await this.profiles.setDraft(p, null);
      if (action === 'home') return void (await this.home(ctx, p));
      if (action === 'cancel') return void (await this.show(ctx, p, 'cancelled', this.nav()));
      if (action === 'language') return void (await this.chooseLanguage(ctx, p));
      if (action === 'settings')
        return void (await this.show(
          ctx,
          p,
          'settings_body',
          [[{ key: 'language', data: 'm:language' }], ...this.nav()],
          { language: languageNames[p.language] },
        ));
      if (action === 'shops' || action === 'all')
        return void (await this.list(ctx, p, action === 'all', Math.max(0, Number(parts[2]) || 0)));
      if (action === 'plans') return void (await this.plans(ctx, p));
      if (action === 'guide') return void (await this.show(ctx, p, 'guide_body', this.guideRows()));
      if (action === 'help') {
        const help = (
          {
            setup: 'setup_intro',
            selling: 'selling_help',
            design: 'design_help',
            wallet: 'wallet_help',
            idle: 'idle_help',
          } as any
        )[parts[2]!];
        if (help)
          return void (await this.show(ctx, p, help, [
            [{ key: 'back', data: 'm:guide' }],
            ...this.nav(),
          ]));
        return;
      }
      if (action === 'create') return void (await this.route(ctx, p, 'open'));
      if (action === 'begin') return void (await this.begin(ctx, p));
      if (action === 'credentials') return void (await this.begin(ctx, p, parts[2]));
      if (action === 'dash') return void (await this.dashboard(ctx, p, parts[2]!));
      if (action === 'sql') return void (await this.sql(ctx, p, parts[2]!));
      if (action === 'act') return void (await this.activate(ctx, p, parts[2]!));
      if (['sub', 'pay', 'cancelpay', 'status'].includes(action)) {
        const result = await this.nss.call(
          (
            {
              sub: 'wallet_quote',
              pay: 'wallet_confirm',
              cancelpay: 'wallet_cancel',
              status: 'wallet_status',
            } as any
          )[action],
          uid,
          action === 'sub' ? { shop_id: parts[2] } : { token: parts[2] },
        );
        return void (await this.checkout(ctx, p, result.checkout));
      }
      if (action === 'confirm') {
        const op = parts[2]!,
          id = parts[3]!;
        if (
          !['pause', 'resume', 'super_resume', 'grant'].includes(op) ||
          (['super_resume', 'grant'].includes(op) && !this.root(uid))
        )
          throw new PlatformError(403, 'FORBIDDEN');
        const { shop } = await this.call('info', p, { shop_id: id });
        await this.profiles.setDraft(p, {
          step: 'action',
          op,
          id,
          receipt: 'manual:' + randomUUID().replace(/-/g, ''),
        });
        return void (await this.show(
          ctx,
          p,
          'confirm_action',
          [[{ key: 'confirm', data: 'm:do' }], [{ key: 'back', data: 'm:dash:' + id }]],
          {
            action: this.content.raw(
              p.language,
              ({ pause: 'pause', resume: 'resume', super_resume: 'unlock', grant: 'grant' } as any)[
                op
              ],
            ),
            bot: shop.bot_username,
          },
        ));
      }
      if (action === 'do') {
        const draft = this.profiles.draft(p);
        if (!draft || draft.step !== 'action')
          return void (await this.show(ctx, p, 'expired', this.nav()));
        await this.call(draft.op, p, { shop_id: draft.id, receipt: draft.receipt });
        await this.profiles.setDraft(p, null);
        return void (await this.dashboard(ctx, p, draft.id));
      }
      if (action === 'super') return void (await this.superHome(ctx, p));
      return void (await this.cmsAction(ctx, p, parts));
    } catch (e) {
      const code = e instanceof PlatformError ? e.code : 'SERVICE_UNAVAILABLE';
      const payToken = /^m:pay:([a-f0-9]{32})$/.exec(ctx.callbackQuery?.data ?? '')?.[1];
      if (payToken && (!(e instanceof PlatformError) || e.status >= 500)) {
        return void (await this.show(
          ctx,
          p,
          'payment_pending',
          [[{ key: 'refresh', data: 'm:status:' + payToken }], ...this.nav()],
          { reference: 'NSS-' + payToken },
        ));
      }
      if (code === 'NSS_ACCOUNT_REQUIRED')
        return void (await this.show(ctx, p, 'account_required', [
          [{ key: 'nss', url: this.nssLink() }],
          ...this.nav(),
        ]));
      return void (await this.show(
        ctx,
        p,
        code === 'FORBIDDEN' ? 'forbidden' : 'error',
        this.nav(),
        { code },
      ));
    }
  }
  private guideRows(): Target[][] {
    return [
      ...['setup', 'selling', 'design', 'wallet', 'idle'].map((key) => [
        { key: 'guide_' + key, data: 'm:help:' + key },
      ]),
      ...this.nav(),
    ];
  }
}
