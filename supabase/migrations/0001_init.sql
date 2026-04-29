-- =====================================================================
-- SafwanTiger Shop Bot — initial schema
-- Run this in the Supabase SQL editor (or `supabase db push`).
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
    referred_by     bigint references public.users(telegram_id) on delete set null,
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
    note         text,           -- 'View Note' content shown on the product page
    price        numeric(14,2) not null check (price >= 0),
    stock        int not null default 0 check (stock >= 0),
    warranty     text,           -- free-form, e.g. "30 days"
    emoji        text,
    active       boolean not null default true,
    created_at   timestamptz not null default now()
);
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_active_idx on public.products(active);

-- ---------- ORDERS ----------
create table if not exists public.orders (
    id           bigserial primary key,
    user_id      bigint not null references public.users(telegram_id) on delete cascade,
    product_id   bigint references public.products(id) on delete set null,
    product_name text not null,                    -- snapshot
    qty          int not null check (qty > 0),
    unit_price   numeric(14,2) not null,
    total        numeric(14,2) not null,
    delivery     text,                             -- delivered code / credentials
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
create index if not exists deposits_user_idx on public.deposits(user_id, created_at desc);
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

-- ---------- SETTINGS (key/value, JSONB) ----------
-- Used to store admin-editable texts, button labels, color modes,
-- premium emoji ids, etc. Keys are namespaced like:
--   text.welcome
--   text.shop.title
--   button.shop
--   color.in_stock        -> "blue" | "green"
--   color.out_of_stock    -> "red"
--   emoji.fire            -> { unicode: "🔥", custom_emoji_id: "5440..." }
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

-- ---------- REFERRALS (audit log) ----------
create table if not exists public.referrals (
    id           bigserial primary key,
    referrer_id  bigint not null references public.users(telegram_id) on delete cascade,
    referee_id   bigint not null references public.users(telegram_id) on delete cascade,
    created_at   timestamptz not null default now(),
    unique (referrer_id, referee_id)
);

-- ---------- VIEW: products with stock state ----------
create or replace view public.products_view as
    select
        p.*,
        c.name as category_name,
        case when p.stock > 0 then true else false end as in_stock
    from public.products p
    left join public.categories c on c.id = p.category_id;

-- =====================================================================
-- Row Level Security
-- The bot connects with the service_role key, so RLS is bypassed.
-- Enable RLS anyway as a defense-in-depth measure for any future
-- anon/auth access (e.g. an admin web dashboard).
-- =====================================================================
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

-- =====================================================================
-- Seed: primary admin (replace with the real ID from your .env)
-- =====================================================================
insert into public.admins (telegram_id, username)
values (7913962419, 'safwantiger')
on conflict (telegram_id) do nothing;

-- Default settings seeds
insert into public.settings (key, value) values
    ('color.in_stock',     '"blue"'::jsonb),
    ('color.out_of_stock', '"red"'::jsonb),
    ('text.welcome',       '"Welcome to SafwanTiger Shop"'::jsonb),
    ('text.menu_button',   '"Main Menu"'::jsonb)
on conflict (key) do nothing;
