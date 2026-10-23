begin;
alter table products add column if not exists wwc_source_id text;
create index if not exists wwc_source_product on products(wwc_source_id) where wwc_source_id is not null;
alter table users drop constraint if exists users_language_check;
alter table users add constraint users_language_check check(language in ('en','ar','vi','zh'));
create table if not exists wwc_shop_sessions(key text primary key,value jsonb not null,expires_at timestamptz not null);
create index if not exists wwc_shop_sessions_expiry on wwc_shop_sessions(expires_at);
create or replace function wwc_shop_sessions_cleanup() returns integer language plpgsql security definer set search_path=public as $$ declare n integer;begin
 delete from wwc_shop_sessions where key in(select key from wwc_shop_sessions where expires_at<now() order by expires_at limit 1000);get diagnostics n=row_count;return n;
end $$;
create table if not exists wwc_platform_shops(
 id text primary key,owner_id bigint not null,owner_lang text not null default 'en',bot_id bigint not null unique,bot_username text not null,
 token_fingerprint text not null unique,database_fingerprint text not null unique,secret_box text not null,
 status text not null default 'setup' check(status in('setup','active','idle','locked','suspended')),
 plan text not null default 'free' check(plan in('free','paid')),paid_until timestamptz,
 idle_strikes integer not null default 0 check(idle_strikes between 0 and 3),last_customer_at timestamptz,last_purchase_at timestamptz,
 last_active_at timestamptz not null default now(),warned_at timestamptz,activation_requested_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table wwc_platform_shops add column if not exists activation_requested_at timestamptz;
create index if not exists wwc_platform_owner on wwc_platform_shops(owner_id,created_at desc);
create index if not exists wwc_platform_active on wwc_platform_shops(last_active_at) where status='active';
create table if not exists wwc_platform_receipts(receipt text primary key,shop_id text not null references wwc_platform_shops(id),actor bigint not null,days integer not null,created_at timestamptz not null default now());
create table if not exists wwc_platform_events(id text primary key,shop_id text not null references wwc_platform_shops(id),kind text not null,created_at timestamptz not null default now());
create table if not exists wwc_platform_nonces(nonce text primary key,created_at timestamptz not null default now());
create table if not exists wwc_platform_lease(id integer primary key check(id=1),owner text not null,expires_at timestamptz not null);
create or replace function wwc_platform_nonce(p_nonce text) returns boolean language plpgsql security definer set search_path=public as $$ begin
 delete from wwc_platform_nonces where created_at<now()-interval '10 minutes';insert into wwc_platform_nonces(nonce) values(p_nonce) on conflict do nothing;return found;
end $$;
create or replace function wwc_platform_lease_claim(p_owner text,p_release boolean default false) returns boolean language plpgsql security definer set search_path=public as $$ begin
 if p_release then delete from wwc_platform_lease where id=1 and owner=p_owner;return true;end if;
 insert into wwc_platform_lease values(1,p_owner,now()+interval '90 seconds') on conflict(id) do update set owner=excluded.owner,expires_at=excluded.expires_at where wwc_platform_lease.owner=p_owner or wwc_platform_lease.expires_at<now();return found;
end $$;
create or replace function wwc_platform_mutate(p_action text,p_id text,p_actor bigint,p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare s wwc_platform_shops;su boolean:=coalesce((p_payload->>'trusted_super')::boolean,false);r wwc_platform_receipts;d integer;
begin
 perform pg_advisory_xact_lock(88210045);
 if p_action='register' then
  if(select count(*) from wwc_platform_shops where owner_id=p_actor)>=(p_payload->>'max_owner_shops')::integer then raise exception 'OWNER_SHOP_LIMIT';end if;
  insert into wwc_platform_shops(id,owner_id,owner_lang,bot_id,bot_username,token_fingerprint,database_fingerprint,secret_box) values(p_id,p_actor,coalesce(p_payload->>'owner_lang','en'),(p_payload->>'bot_id')::bigint,p_payload->>'bot_username',p_payload->>'token_fingerprint',p_payload->>'database_fingerprint',p_payload->>'secret_box') returning * into s;return to_jsonb(s);
 end if;
 select * into s from wwc_platform_shops where id=p_id for update;if not found then raise exception 'SHOP_NOT_FOUND';end if;
 if s.owner_id<>p_actor and not su then raise exception 'FORBIDDEN';end if;
 if p_action in('activate','resume','super_resume') then
  if s.status='suspended' and not su then raise exception 'ADMIN_SUSPENDED';end if;
  if s.idle_strikes>=3 and not su then raise exception 'OWNER_UNLOCK_REQUIRED';end if;
  if s.status<>'active' and(select count(*) from wwc_platform_shops where status='active')>=(p_payload->>'max_active_shops')::integer then raise exception 'HOST_CAPACITY';end if;
  update wwc_platform_shops set status='active',last_active_at=now(),warned_at=null,activation_requested_at=null,idle_strikes=case when su then 0 else idle_strikes end where id=p_id;
 elsif p_action='queue' then
  if s.status in('locked','suspended') then raise exception 'OWNER_UNLOCK_REQUIRED';end if;
  update wwc_platform_shops set activation_requested_at=coalesce(activation_requested_at,now()) where id=p_id;
 elsif p_action='unqueue' then update wwc_platform_shops set activation_requested_at=null where id=p_id;
 elsif p_action='pause' then update wwc_platform_shops set status=case when su then 'suspended' else 'idle' end,activation_requested_at=null where id=p_id;
 elsif p_action='subscribe' then
  d:=(p_payload->>'days')::integer;if d<1 or d>365 then raise exception 'INVALID_DAYS';end if;
  select * into r from wwc_platform_receipts where receipt=p_payload->>'receipt';if found then if r.shop_id<>p_id or r.actor<>p_actor then raise exception 'RECEIPT_CONFLICT';end if;return to_jsonb(s);end if;
  insert into wwc_platform_receipts(receipt,shop_id,actor,days) values(p_payload->>'receipt',p_id,p_actor,d);
  update wwc_platform_shops set plan='paid',paid_until=greatest(coalesce(paid_until,now()),now())+make_interval(days=>d) where id=p_id;
 elsif p_action='activity' then
  if not su then raise exception 'FORBIDDEN';end if;
  insert into wwc_platform_events(id,shop_id,kind) values(p_payload->>'event',p_id,p_payload->>'kind') on conflict do nothing;
  if found then update wwc_platform_shops set last_active_at=now(),warned_at=null,last_customer_at=case when p_payload->>'kind'='customer' then now() else last_customer_at end,last_purchase_at=case when p_payload->>'kind'='purchase' then now() else last_purchase_at end,idle_strikes=case when p_payload->>'kind'='purchase' then 0 else idle_strikes end where id=p_id;end if;
 elsif p_action='idle' then
  if not su then raise exception 'FORBIDDEN';end if;
  if s.status='active' and s.last_active_at<now()-make_interval(hours=>(p_payload->>'hours')::integer) then update wwc_platform_shops set idle_strikes=least(3,idle_strikes+1),status=case when idle_strikes+1>=3 then 'locked' else 'idle' end where id=p_id;end if;
 elsif p_action='warn' then
  if not su then raise exception 'FORBIDDEN';end if;update wwc_platform_shops set warned_at=now() where id=p_id and warned_at is null;
 elsif p_action='credentials' then
  update wwc_platform_shops set secret_box=p_payload->>'secret_box',token_fingerprint=p_payload->>'token_fingerprint',database_fingerprint=p_payload->>'database_fingerprint',status=case when status in('locked','suspended') then status else 'setup' end where id=p_id;
 else raise exception 'INVALID_ACTION';end if;
 update wwc_platform_shops set updated_at=now() where id=p_id returning * into s;
 delete from wwc_platform_events where kind='customer' and created_at<now()-interval '7 days';return to_jsonb(s);
end $$;
create or replace function shop_platform_statistics() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('users',(select count(*) from users),'orders',(select count(*) from orders where status='paid'),'revenue',(select coalesce(sum(total),0) from orders where status='paid'),
 'known_supplier_profit',(select coalesce(sum(o.total-coalesce((a.result->>'total_price')::numeric,(a.result->'data'->>'total_price')::numeric)),0) from orders o join supplier_order_attempts a on a.order_id=o.id where o.status='paid' and a.state='success' and(a.result ? 'total_price' or a.result->'data' ? 'total_price')),
 'last_purchase_at',(select max(created_at) from orders where status='paid' and fulfillment_state='delivered'))
$$;
do $$ declare n text;f record;begin
 foreach n in array array['wwc_shop_sessions','wwc_platform_shops','wwc_platform_receipts','wwc_platform_events','wwc_platform_nonces','wwc_platform_lease'] loop execute format('alter table public.%I enable row level security',n);execute format('revoke all on public.%I from public,anon,authenticated',n);execute format('grant all on public.%I to service_role',n);end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and(p.proname like 'wwc_platform_%' or p.proname in('shop_platform_statistics','wwc_shop_sessions_cleanup')) loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;
end $$;
commit;
