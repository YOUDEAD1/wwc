-- Create reseller_api_pricing and reseller_api_hidden tables
create table if not exists public.reseller_api_pricing (
    api_key_id bigint not null references public.reseller_api_keys(id) on delete cascade,
    product_id bigint not null references public.products(id) on delete cascade,
    sell_price numeric(14,2) not null check (sell_price >= 0),
    name_ar text,
    name_en text,
    desc_ar text,
    desc_en text,
    updated_at timestamptz not null default now(),
    primary key (api_key_id, product_id)
);

create table if not exists public.reseller_api_hidden (
    api_key_id bigint not null references public.reseller_api_keys(id) on delete cascade,
    product_id bigint not null references public.products(id) on delete cascade,
    primary key (api_key_id, product_id)
);

alter table public.reseller_api_pricing enable row level security;
alter table public.reseller_api_hidden enable row level security;
