/**
 * Tenant Database Initializer
 * 
 * Automatically creates all required tables in a tenant's Supabase
 * database when a new tenant is added via super admin.
 * Uses the Supabase SQL API (service_role key) to execute DDL.
 */
import { logger } from '../logger.js';

/**
 * The minimal schema SQL needed for a tenant bot to function.
 * Uses IF NOT EXISTS everywhere so it's safe to re-run.
 * The owner_telegram_id parameter is injected into the admin seed.
 */
function buildTenantSQL(ownerTelegramId: number): string {
  return `
-- =====================================================================
-- AUTO-GENERATED TENANT SCHEMA — Safe to re-run (IF NOT EXISTS)
-- =====================================================================

-- ---------- USERS ----------
create table if not exists public.users (
    telegram_id     bigint primary key,
    username        text,
    first_name      text,
    last_name       text,
    language        text not null default 'en' check (language in ('en','ar','vi')),
    balance         numeric(14,2) not null default 0,
    stock_alert     boolean not null default true,
    announcements   boolean not null default true,
    ref_code        text unique,
    referred_by     bigint,
    joined_at       timestamptz not null default now(),
    last_seen_at    timestamptz not null default now()
);
create index if not exists users_referred_by_idx on public.users(referred_by);

-- ---------- ADMINS ----------
create table if not exists public.admins (
    telegram_id  bigint primary key,
    username     text,
    added_at     timestamptz not null default now()
);

-- ---------- CATEGORIES ----------
create table if not exists public.categories (
    id          bigserial primary key,
    name        text not null,
    emoji       text,
    sort_order  int not null default 0,
    active      boolean not null default true,
    created_at  timestamptz not null default now()
);

-- ---------- PRODUCTS ----------
create table if not exists public.products (
    id           bigserial primary key,
    category_id  bigint references public.categories(id) on delete cascade,
    name         text not null,
    description  text,
    note         text,
    price        numeric(14,2) not null check (price >= 0),
    stock        int not null default 0 check (stock >= 0),
    warranty     text,
    emoji        text,
    active       boolean not null default true,
    created_at   timestamptz not null default now()
);
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_active_idx   on public.products(active);

-- ---------- ORDERS ----------
create table if not exists public.orders (
    id           bigserial primary key,
    user_id      bigint not null references public.users(telegram_id) on delete cascade,
    product_id   bigint references public.products(id) on delete set null,
    product_name text not null,
    qty          int not null check (qty > 0),
    unit_price   numeric(14,2) not null,
    total        numeric(14,2) not null,
    delivery     text,
    status       text not null default 'paid' check (status in ('paid','refunded','cancelled')),
    created_at   timestamptz not null default now()
);
create index if not exists orders_user_idx on public.orders(user_id, created_at desc);

-- ---------- DEPOSITS ----------
create table if not exists public.deposits (
    id          bigserial primary key,
    user_id     bigint not null references public.users(telegram_id) on delete cascade,
    method      text not null,
    amount      numeric(14,2) not null check (amount > 0),
    status      text not null default 'pending' check (status in ('pending','approved','rejected')),
    reference   text,
    note        text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists deposits_user_idx   on public.deposits(user_id, created_at desc);
create index if not exists deposits_status_idx on public.deposits(status);

-- ---------- PAYMENT METHODS ----------
create table if not exists public.payment_methods (
    id            bigserial primary key,
    name          text not null,
    instructions  text not null,
    min_amount    numeric(14,2) not null default 1,
    active        boolean not null default true,
    sort_order    int not null default 0,
    created_at    timestamptz not null default now()
);

-- ---------- SETTINGS ----------
create table if not exists public.settings (
    key         text primary key,
    value       jsonb not null,
    updated_by  bigint,
    updated_at  timestamptz not null default now()
);

-- ---------- ANNOUNCEMENTS ----------
create table if not exists public.announcements (
    id           bigserial primary key,
    body         text not null,
    sent_at      timestamptz,
    created_by   bigint,
    created_at   timestamptz not null default now()
);

-- ---------- REFERRALS ----------
create table if not exists public.referrals (
    id           bigserial primary key,
    referrer_id  bigint not null references public.users(telegram_id) on delete cascade,
    referee_id   bigint not null references public.users(telegram_id) on delete cascade,
    created_at   timestamptz not null default now(),
    unique (referrer_id, referee_id)
);

-- ---------- VIEW ----------
drop view if exists public.products_view cascade;
create or replace view public.products_view as
    select
        p.*,
        c.name as category_name,
        case when p.stock > 0 then true else false end as in_stock
    from public.products p
    left join public.categories c on c.id = p.category_id;

-- ---------- RLS ----------
alter table public.users           enable row level security;
alter table public.admins          enable row level security;
alter table public.categories      enable row level security;
alter table public.products        enable row level security;
alter table public.orders          enable row level security;
alter table public.deposits        enable row level security;
alter table public.payment_methods enable row level security;
alter table public.settings        enable row level security;
alter table public.announcements   enable row level security;
alter table public.referrals       enable row level security;

-- ---------- SEED ADMIN ----------
insert into public.admins (telegram_id, username)
values (${ownerTelegramId}, 'owner')
on conflict (telegram_id) do nothing;

-- Default settings
insert into public.settings (key, value) values
    ('color.in_stock',     '"blue"'::jsonb),
    ('color.out_of_stock', '"red"'::jsonb)
on conflict (key) do nothing;

-- =====================================================================
-- EXTRA COLUMNS (from later migrations)
-- =====================================================================

-- payment_methods extras
alter table public.payment_methods
    add column if not exists provider text not null default 'manual';

alter table public.payment_methods
    drop constraint if exists payment_methods_provider_check;
alter table public.payment_methods
    add constraint payment_methods_provider_check
    check (provider in ('manual','binance_pay','usdt_trc20','usdt_bep20','usdt_ton','ltc'));

alter table public.payment_methods
    add column if not exists address text,
    add column if not exists pay_name text,
    add column if not exists button_color text,
    add column if not exists emoji_id text;

-- deposits extras
alter table public.deposits
    add column if not exists tx_hash text,
    add column if not exists expected_amount numeric(20, 8),
    add column if not exists quote_expires_at timestamptz,
    add column if not exists order_intent jsonb;

create index if not exists deposits_reference_idx on public.deposits (reference);
create index if not exists deposits_tx_hash_idx   on public.deposits (tx_hash);
create unique index if not exists deposits_tx_hash_uniq
    on public.deposits (tx_hash) where tx_hash is not null;

-- users extras
alter table public.users
    add column if not exists email     text,
    add column if not exists region    text,
    add column if not exists timezone  text,
    add column if not exists status    text,
    add column if not exists wallet_alert boolean not null default true,
    add column if not exists referral_earned_total numeric(14,2) not null default 0,
    add column if not exists referral_available    numeric(14,2) not null default 0,
    add column if not exists referral_transferred  numeric(14,2) not null default 0,
    add column if not exists referral_withdrawn    numeric(14,2) not null default 0,
    add column if not exists is_banned     boolean not null default false,
    add column if not exists banned_at     timestamptz,
    add column if not exists banned_reason text,
    add column if not exists email_nag_disabled boolean not null default false,
    add column if not exists last_email_nag_at  timestamptz,
    add column if not exists currency text,
    add column if not exists pending_referral_by bigint default null,
    add column if not exists sub_verified boolean not null default false;

create index if not exists users_is_banned_idx on public.users(is_banned) where is_banned = true;

-- products extras
alter table public.products
    add column if not exists sort_order int not null default 0,
    add column if not exists emoji_id           text,
    add column if not exists note_file_id       text,
    add column if not exists note_file_name     text,
    add column if not exists note_file_mime     text,
    add column if not exists tutorial_text      text,
    add column if not exists tutorial_file_id   text,
    add column if not exists tutorial_file_type text,
    add column if not exists tutorial_url       text,
    add column if not exists unlimited_stock    boolean not null default false,
    add column if not exists referral_required_count int not null default 0,
    add column if not exists pinned boolean not null default false,
    add column if not exists oos_sort_order int,
    add column if not exists delivery_form jsonb;

create index if not exists products_sort_order_idx on public.products(sort_order, id);

-- orders extras
alter table public.orders
    add column if not exists discount numeric(14,2) not null default 0,
    add column if not exists promo_id bigint,
    add column if not exists delivered_items text;

create index if not exists orders_promo_idx on public.orders(promo_id) where promo_id is not null;

-- wallet_ledger
create table if not exists public.wallet_ledger (
    id          bigserial primary key,
    user_id     bigint not null references public.users(telegram_id) on delete cascade,
    type        text   not null,
    amount      numeric(14,2) not null,
    reference   text,
    created_at  timestamptz not null default now()
);
create index if not exists wallet_ledger_user_idx
    on public.wallet_ledger(user_id, created_at desc);

-- gift codes
create table if not exists public.gift_codes (
    code              text primary key,
    amount            numeric(14,2) not null,
    max_redemptions   integer,
    per_user_limit    integer not null default 1,
    expires_at        timestamptz,
    note              text,
    created_by        bigint,
    created_at        timestamptz not null default now()
);
create table if not exists public.gift_code_redemptions (
    id          bigserial primary key,
    code        text not null references public.gift_codes(code) on delete cascade,
    user_id     bigint not null references public.users(telegram_id) on delete cascade,
    amount      numeric(14,2) not null,
    redeemed_at timestamptz not null default now()
);
create index if not exists gift_redemptions_user_idx on public.gift_code_redemptions(user_id);
create index if not exists gift_redemptions_code_idx on public.gift_code_redemptions(code);

-- user price overrides
create table if not exists public.user_price_overrides (
    telegram_id  bigint not null,
    product_id   bigint not null references public.products(id) on delete cascade,
    price        numeric(14,2) not null check (price >= 0),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    created_by   bigint,
    primary key (telegram_id, product_id)
);
create index if not exists user_price_overrides_telegram_idx on public.user_price_overrides(telegram_id);
create index if not exists user_price_overrides_product_idx  on public.user_price_overrides(product_id);

-- promos
create table if not exists public.promos (
    id              bigserial primary key,
    product_id      bigint references public.products(id) on delete cascade,
    telegram_id     bigint,
    name            text,
    min_qty         int not null check (min_qty >= 1),
    discount_amount numeric(14,2) not null check (discount_amount >= 0),
    active          boolean not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    created_by      bigint
);
create index if not exists promos_scope_idx on public.promos(coalesce(telegram_id, 0), coalesce(product_id, 0)) where active;
create index if not exists promos_product_idx on public.promos(product_id) where active;
create index if not exists promos_user_idx on public.promos(telegram_id) where active;

-- promo exclusions
alter table public.promos
    add column if not exists excluded_user_ids bigint[] not null default '{}';

-- product items
create table if not exists public.product_items (
    id                bigserial primary key,
    product_id        bigint not null references public.products(id) on delete cascade,
    payload           text not null,
    consumed_at       timestamptz,
    consumed_order_id bigint,
    created_at        timestamptz not null default now()
);
create index if not exists product_items_pool
    on public.product_items(product_id, id) where consumed_at is null;
alter table public.product_items enable row level security;

-- order delivery submissions
create table if not exists public.order_delivery_submissions (
    id         bigserial primary key,
    order_id   bigint not null references public.orders(id) on delete cascade,
    field_key  text not null,
    value      text not null default '',
    created_at timestamptz not null default now()
);
create index if not exists order_delivery_submissions_order_idx
    on public.order_delivery_submissions(order_id);

-- referral redemptions
create table if not exists public.referral_redemptions (
    id             bigserial primary key,
    user_id        bigint not null references public.users(telegram_id) on delete cascade,
    product_id     bigint not null references public.products(id) on delete cascade,
    order_id       bigint references public.orders(id) on delete set null,
    referral_cost  int not null default 0,
    redeemed_at    timestamptz not null default now()
);
create index if not exists referral_redemptions_user_idx on public.referral_redemptions(user_id);
create index if not exists referral_redemptions_product_idx on public.referral_redemptions(product_id);
alter table public.referral_redemptions enable row level security;

-- referral conversions
create table if not exists public.referral_conversions (
    id          bigserial primary key,
    user_id     bigint not null references public.users(telegram_id) on delete cascade,
    refs_spent  int not null check (refs_spent > 0),
    amount      numeric(14,2) not null check (amount > 0),
    created_at  timestamptz not null default now()
);
create index if not exists referral_conversions_user_idx
    on public.referral_conversions(user_id, created_at desc);
alter table public.referral_conversions enable row level security;

-- referral adjustments
create table if not exists public.referral_adjustments (
    id          bigserial primary key,
    user_id     bigint not null references public.users(telegram_id) on delete cascade,
    delta       int not null check (delta <> 0),
    reason      text,
    created_by  bigint,
    created_at  timestamptz not null default now()
);
create index if not exists referral_adjustments_user_idx
    on public.referral_adjustments(user_id, created_at desc);
alter table public.referral_adjustments enable row level security;

-- supplier API tables
create table if not exists public.supplier_api_sources (
    id bigserial primary key,
    name text not null,
    base_url text not null,
    api_key text not null default '',
    auth_mode text not null default 'x-api-key'
        check (auth_mode in ('none', 'bearer', 'x-api-key', 'query')),
    key_header text not null default 'x-api-key',
    key_query_param text not null default 'api_key',
    products_path text not null default '/products',
    balance_path text not null default '/balance',
    order_path text not null default '/order',
    order_method text not null default 'POST'
        check (order_method in ('GET', 'POST')),
    balance_json_path text not null default 'balance',
    products_json_path text not null default 'products',
    product_id_json_path text not null default 'id',
    product_name_json_path text not null default 'name',
    product_price_json_path text not null default 'price',
    product_stock_json_path text not null default 'stock',
    order_items_json_path text not null default 'items',
    order_status_json_path text not null default 'status',
    order_request_template jsonb not null default
        '{"product_id":"{{supplier_product_id}}","quantity":"{{qty}}","request_id":"{{request_id}}"}'::jsonb,
    enabled boolean not null default true,
    markup_percent numeric(8,2) not null default 25,
    fixed_markup numeric(12,4) not null default 0,
    low_balance_threshold numeric(12,4) not null default 5,
    notes text,
    last_balance numeric(12,4),
    last_sync_at timestamptz,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    auto_import_new_products boolean not null default false,
    auto_import_active boolean not null default false,
    import_category_name text
);

create table if not exists public.supplier_product_links (
    id bigserial primary key,
    local_product_id integer not null references public.products(id) on delete cascade,
    supplier_id bigint not null references public.supplier_api_sources(id) on delete cascade,
    supplier_product_id text not null,
    supplier_product_name text,
    supplier_cost numeric(12,4),
    supplier_stock integer,
    auto_order boolean not null default true,
    auto_sync_stock boolean not null default true,
    fallback_manual boolean not null default true,
    last_sync_at timestamptz,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (local_product_id)
);

create table if not exists public.supplier_order_logs (
    id bigserial primary key,
    supplier_id bigint references public.supplier_api_sources(id) on delete set null,
    local_order_id bigint references public.orders(id) on delete cascade,
    local_product_id integer references public.products(id) on delete set null,
    supplier_product_id text,
    status text not null default 'pending'
        check (status in ('pending', 'success', 'failed', 'manual')),
    request_payload jsonb not null default '{}'::jsonb,
    response_payload jsonb not null default '{}'::jsonb,
    error text,
    created_at timestamptz not null default now()
);

-- Recreate view with all new columns
drop view if exists public.products_view cascade;
create or replace view public.products_view as
    select
        p.*,
        c.name as category_name,
        case when p.stock > 0 then true else false end as in_stock
    from public.products p
    left join public.categories c on c.id = p.category_id;

-- =====================================================================
-- RPC FUNCTIONS
-- =====================================================================

create or replace function public.spend_referral_balance(
    p_user_id bigint,
    p_product_id bigint,
    p_order_id bigint,
    p_referral_cost int
)
returns table (total_referrals int, spent_referrals int, available_referrals int)
language plpgsql security definer set search_path = public
as $$
declare v_total int; v_spent int;
begin
    if p_referral_cost <= 0 then raise exception 'INVALID_REFERRAL_COST'; end if;
    perform pg_advisory_xact_lock(p_user_id);
    select greatest(0,
        (select count(*)::int from public.referrals where referrer_id = p_user_id)
        + coalesce((select sum(delta) from public.referral_adjustments where user_id = p_user_id), 0)::int
    ) into v_total;
    select
        coalesce((select sum(referral_cost) from public.referral_redemptions where user_id = p_user_id), 0)::int
        + coalesce((select sum(refs_spent) from public.referral_conversions where user_id = p_user_id), 0)::int
    into v_spent;
    if (v_total - v_spent) < p_referral_cost then raise exception 'INSUFFICIENT_REFERRALS'; end if;
    insert into public.referral_redemptions (user_id, product_id, order_id, referral_cost)
    values (p_user_id, p_product_id, p_order_id, p_referral_cost);
    return query select v_total, v_spent + p_referral_cost, v_total - v_spent - p_referral_cost;
end;
$$;

create or replace function public.convert_referrals_to_wallet(
    p_user_id bigint,
    p_referral_cost int default 20,
    p_usdt_amount numeric default 1.00
)
returns table (total_referrals int, spent_referrals int, available_referrals int, converted_amount numeric, new_balance numeric)
language plpgsql security definer set search_path = public
as $$
declare v_total int; v_spent int; v_new_balance numeric;
begin
    if p_referral_cost <= 0 then raise exception 'INVALID_REFERRAL_COST'; end if;
    if p_usdt_amount <= 0 then raise exception 'INVALID_CONVERSION_AMOUNT'; end if;
    perform pg_advisory_xact_lock(p_user_id);
    select greatest(0,
        (select count(*)::int from public.referrals where referrer_id = p_user_id)
        + coalesce((select sum(delta) from public.referral_adjustments where user_id = p_user_id), 0)::int
    ) into v_total;
    select
        coalesce((select sum(referral_cost) from public.referral_redemptions where user_id = p_user_id), 0)::int
        + coalesce((select sum(refs_spent) from public.referral_conversions where user_id = p_user_id), 0)::int
    into v_spent;
    if (v_total - v_spent) < p_referral_cost then raise exception 'INSUFFICIENT_REFERRALS'; end if;
    insert into public.referral_conversions (user_id, refs_spent, amount) values (p_user_id, p_referral_cost, p_usdt_amount);
    update public.users set balance = coalesce(balance, 0) + p_usdt_amount where telegram_id = p_user_id returning balance into v_new_balance;
    if v_new_balance is null then raise exception 'USER_NOT_FOUND'; end if;
    insert into public.wallet_ledger (user_id, type, amount, reference) values (p_user_id, 'referral_convert', p_usdt_amount, 'referral_convert:' || p_referral_cost::text);
    return query select v_total, v_spent + p_referral_cost, v_total - v_spent - p_referral_cost, p_usdt_amount, v_new_balance;
end;
$$;

grant execute on function public.spend_referral_balance(bigint, bigint, bigint, int) to service_role;
grant execute on function public.convert_referrals_to_wallet(bigint, int, numeric) to service_role;
`.trim();
}

/**
 * Initialize a tenant's Supabase database by running all required DDL.
 * Uses the Supabase SQL API endpoint which accepts raw SQL via service_role.
 */
export async function initTenantDatabase(
  supabaseUrl: string,
  serviceKey: string,
  ownerTelegramId: number,
): Promise<{ success: boolean; error?: string }> {
  const sql = buildTenantSQL(ownerTelegramId);

  // Supabase exposes a /rest/v1/rpc endpoint, but for raw SQL we can use
  // the pg-meta/query endpoint available to service_role:
  //   POST /pg/query  (Supabase Studio's internal API — not always exposed)
  //
  // A more reliable method: create a temporary RPC function, call it, drop it.
  // Or use the supabase-js client to call individual statements.
  //
  // Simplest approach: use the Supabase Management API SQL endpoint.
  // /rest/v1/rpc requires a function to exist. So we chunk the SQL and
  // execute via a lightweight wrapper.

  const projectRef = supabaseUrl.replace('https://', '').split('.')[0];
  const sqlApiUrl = `https://${projectRef}.supabase.co/rest/v1/rpc/`;

  // Try the approach: create a temp function that runs DDL,
  // then call it, then drop it.
  const wrapperSQL = `
    create or replace function public.__init_schema()
    returns void language plpgsql security definer as $fn$
    begin
      ${sql.replace(/\$/g, '$$$$')}
    end;
    $fn$;
  `;

  // Unfortunately Supabase PostgREST doesn't support arbitrary SQL.
  // The only reliable way is using the database connection string directly.
  // Since we don't have pg client, we'll use a workaround:
  // Execute via fetch to the Supabase SQL endpoint (internal).
  
  try {
    // Method: Use Supabase's internal pg endpoint
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });

    // If we can reach the API, try creating tables via individual RPC calls
    // Since we can't run raw SQL, we'll use a different approach:
    // Execute each CREATE TABLE as a single statement via pg-meta
    
    const pgResponse = await fetch(
      `${supabaseUrl.replace('.supabase.co', '.supabase.co')}/pg/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'x-connection-encrypted': 'true',
        },
        body: JSON.stringify({ query: sql }),
      },
    );

    if (pgResponse.ok) {
      logger.info({ projectRef }, 'tenant database initialized via pg/query');
      return { success: true };
    }

    // Fallback: try the newer /sql endpoint
    const sqlResponse = await fetch(
      `${supabaseUrl}/sql`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ query: sql }),
      },
    );

    if (sqlResponse.ok) {
      logger.info({ projectRef }, 'tenant database initialized via /sql');
      return { success: true };
    }

    const errText = await sqlResponse.text().catch(() => 'unknown');
    logger.warn(
      { projectRef, status: sqlResponse.status, errText },
      'tenant DB auto-init failed — SQL must be run manually',
    );
    return { success: false, error: `HTTP ${sqlResponse.status}: ${errText}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, projectRef }, 'tenant DB auto-init network error');
    return { success: false, error: msg };
  }
}

/** Export the SQL builder for manual use (e.g. copy to clipboard) */
export { buildTenantSQL };
