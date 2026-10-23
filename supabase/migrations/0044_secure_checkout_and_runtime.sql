-- Non-destructive upgrade. Historical balances and referral prices are never recalculated.
begin;
alter table public.users add column if not exists language_selected boolean not null default true;
alter table public.users alter column language_selected set default false;
alter table public.users add column if not exists referral_invalidated boolean not null default false;
alter table public.products add column if not exists catalog_hidden boolean not null default false;
alter table public.products add column if not exists api_auto_hidden boolean not null default false;

create table if not exists public.runtime_versions(name text primary key, version bigint not null default 0);
insert into public.runtime_versions(name) values('settings'),('catalog_static'),('catalog_availability') on conflict do nothing;
create or replace function public.bump_runtime_version() returns trigger language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
 if tg_table_name='settings' then
  r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if r->>'key' like 'tenant:%' or r->>'key' like 'live_support%' or r->>'key' in ('api_shop_config','api_connection') then return null; end if;
  if tg_op='UPDATE' and old.value is not distinct from new.value then return null; end if;
  update runtime_versions set version=version+1 where name='settings';
 else
  update runtime_versions set version=version+1 where name='catalog_availability';
  if tg_op<>'UPDATE' or (to_jsonb(old)-array['stock','active','api_auto_hidden','catalog_hidden','sort_order','is_pinned','unlimited_stock','stashed_sort_order']) is distinct from (to_jsonb(new)-array['stock','active','api_auto_hidden','catalog_hidden','sort_order','is_pinned','unlimited_stock','stashed_sort_order']) then
   update runtime_versions set version=version+1 where name='catalog_static';
  end if;
 end if;
 return null;
end $$;
drop trigger if exists runtime_settings_revision on public.settings;
create trigger runtime_settings_revision after insert or update or delete on public.settings for each row execute function public.bump_runtime_version();
drop trigger if exists runtime_products_revision on public.products;
create trigger runtime_products_revision after insert or update or delete on public.products for each row execute function public.bump_runtime_version();
drop trigger if exists runtime_categories_revision on public.categories;
create trigger runtime_categories_revision after insert or update or delete on public.categories for each row execute function public.bump_runtime_version();
create or replace function public.runtime_revisions() returns jsonb language sql stable security definer set search_path=public as $$ select jsonb_object_agg(name,version) from runtime_versions $$;
create or replace function public.runtime_settings_snapshot() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('revision',(select version from runtime_versions where name='settings'),'values',coalesce((select jsonb_object_agg(key,value) from settings where key not like 'tenant:%' and key not like 'live_support%' and key not in ('api_shop_config','api_connection')),'{}'::jsonb))
$$;
create or replace function public.catalog_availability() returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'stock',p.stock,'active',p.active and not p.catalog_hidden and not p.api_auto_hidden and coalesce(c.active,true),'catalog_hidden',p.catalog_hidden,'api_auto_hidden',p.api_auto_hidden,'unlimited_stock',p.unlimited_stock,'sort_order',p.sort_order,'is_pinned',p.is_pinned)),'[]'::jsonb) from products p left join categories c on c.id=p.category_id
$$;

create table if not exists public.wallet_operations(user_id bigint not null references public.users(telegram_id), operation_key text not null, delta numeric not null, balance_after numeric not null, primary key(user_id,operation_key));
create or replace function public.adjust_balance(p_telegram_id bigint,p_delta numeric) returns numeric language plpgsql security definer set search_path=public as $$
declare b numeric;
begin
 if p_delta is null or p_delta='NaN'::numeric then raise exception 'INVALID_AMOUNT'; end if;
 update users set balance=balance+p_delta where telegram_id=p_telegram_id and (p_delta>=0 or balance>=-p_delta) returning balance into b;
 if b is null then raise exception 'INSUFFICIENT_FUNDS_OR_USER_NOT_FOUND'; end if;
 return b;
end $$;
create or replace function public.apply_wallet_change(p_user_id bigint,p_delta numeric,p_type text,p_key text) returns numeric language plpgsql security definer set search_path=public as $$
declare b numeric; old_delta numeric;
begin
 perform 1 from users where telegram_id=p_user_id for update;
 select balance_after,delta into b,old_delta from wallet_operations where user_id=p_user_id and operation_key=p_key;
 if found then if old_delta<>p_delta then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return b; end if;
 b:=adjust_balance(p_user_id,p_delta);
 insert into wallet_ledger(user_id,type,amount,reference) values(p_user_id,p_type,p_delta,p_key);
 insert into wallet_operations values(p_user_id,p_key,p_delta,b);
 return b;
end $$;

create table if not exists public.rate_limits(key text primary key,count integer not null,reset_at timestamptz not null);
create or replace function public.consume_rate_limit(p_key text,p_max integer,p_window_ms integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r rate_limits;
begin
 if p_max<1 or p_window_ms<1 then raise exception 'INVALID_RATE_LIMIT'; end if;
 insert into rate_limits values(p_key,1,now()+p_window_ms*interval '1 millisecond')
 on conflict(key) do update set count=case when rate_limits.reset_at<=now() then 1 else rate_limits.count+1 end,reset_at=case when rate_limits.reset_at<=now() then excluded.reset_at else rate_limits.reset_at end returning * into r;
 if random()<0.01 then delete from rate_limits where reset_at<now()-interval '1 day'; end if;
 return jsonb_build_object('ok',r.count<=p_max,'remaining',greatest(0,p_max-r.count),'retryAfterMs',greatest(0,extract(epoch from(r.reset_at-now()))*1000));
end $$;

create or replace function public.referral_setting(p_name text,p_default numeric) returns numeric language plpgsql stable security definer set search_path=public as $$
declare v jsonb; n numeric;
begin
 select value into v from settings where key in ('text.referral.'||p_name,'referral.'||p_name) order by (key like 'text.%') desc limit 1;
 begin n:=(v#>>'{}')::numeric; exception when others then n:=null; end;
 return coalesce(n,p_default);
end $$;
create or replace function public.confirm_referral_atomic(p_user_id bigint) returns jsonb language plpgsql security definer set search_path=public as $$
declare u users; rid bigint; lim integer;
begin
 -- Serialise confirmations for the same referrer as well as the referred user.
 select pending_referral_by into rid from users where telegram_id=p_user_id;
 if rid is not null then perform pg_advisory_xact_lock(rid); end if;
 select * into u from users where telegram_id=p_user_id for update;
 if u.sub_verified or u.referral_invalidated or u.pending_referral_by is null or rid=p_user_id then return jsonb_build_object('confirmed',false); end if;
 lim:=referral_setting('limit_per_day',0)::integer;
 update users set pending_referral_by=null,sub_verified=true where telegram_id=p_user_id;
 if not exists(select 1 from users where telegram_id=rid) or (lim>0 and (select count(*) from referrals where referrer_id=rid and created_at>=now()-interval '1 day')>=lim) then return jsonb_build_object('confirmed',false); end if;
 insert into referrals(referrer_id,referee_id) values(rid,p_user_id) on conflict do nothing;
 if not found then return jsonb_build_object('confirmed',false); end if;
 update users set referred_by=rid where telegram_id=p_user_id;
 return jsonb_build_object('confirmed',true,'referrer_id',rid);
end $$;
create or replace function public.convert_referrals_to_wallet(p_user_id bigint,p_referral_cost int default 20,p_usdt_amount numeric default 1.00)
returns table(total_referrals int,spent_referrals int,available_referrals int,converted_amount numeric,new_balance numeric)
language plpgsql security definer set search_path=public as $$
declare tot int; spent int; b numeric;
begin
 if p_referral_cost<1 or p_referral_cost<>referral_setting('cost',20) or p_usdt_amount<=0 or p_usdt_amount<>referral_setting('amount',1) then raise exception 'REFERRAL_RATE_CHANGED'; end if;
 perform pg_advisory_xact_lock(p_user_id);
 perform 1 from users where telegram_id=p_user_id for update;
 select greatest(0,(select count(*) from referrals where referrer_id=p_user_id)+coalesce((select sum(delta) from referral_adjustments where user_id=p_user_id),0))::int into tot;
 select (coalesce((select sum(referral_cost) from referral_redemptions where user_id=p_user_id),0)+coalesce((select sum(refs_spent) from referral_conversions where user_id=p_user_id),0))::int into spent;
 if tot-spent<p_referral_cost then raise exception 'INSUFFICIENT_REFERRALS'; end if;
 insert into referral_conversions(user_id,refs_spent,amount) values(p_user_id,p_referral_cost,p_usdt_amount);
 update users set balance=balance+p_usdt_amount,referral_earned_total=referral_earned_total+p_usdt_amount,referral_transferred=referral_transferred+p_usdt_amount where telegram_id=p_user_id returning balance into b;
 if b is null then raise exception 'USER_NOT_FOUND'; end if;
 insert into wallet_ledger(user_id,type,amount,reference) values(p_user_id,'referral_convert',p_usdt_amount,'referral_convert:'||p_referral_cost);
 return query select tot,spent+p_referral_cost,tot-spent-p_referral_cost,p_usdt_amount,b;
end $$;

-- Additional transactional checkout functions are defined below before COMMIT.
alter table public.orders add column if not exists checkout_key text;
alter table public.orders add column if not exists allocated_items text[] not null default '{}';
alter table public.orders add column if not exists stock_reserved boolean not null default false;
alter table public.orders add column if not exists is_preorder boolean not null default false;
alter table public.orders add column if not exists fulfillment_state text not null default 'legacy';
alter table public.orders add column if not exists delivery_lease_until timestamptz;
create unique index if not exists orders_checkout_key_unique on public.orders(user_id,checkout_key) where checkout_key is not null;

create or replace function public.spend_referral_balance(p_user_id bigint,p_product_id bigint,p_order_id bigint,p_referral_cost int)
returns table(total_referrals int,spent_referrals int,available_referrals int) language plpgsql security definer set search_path=public as $$
declare tot int; spent int; expected int; existing int;
begin
 perform pg_advisory_xact_lock(p_user_id);
 select p.referral_required_count*o.qty into expected from products p join orders o on o.product_id=p.id where o.id=p_order_id and o.user_id=p_user_id and p.id=p_product_id;
 if expected is null or expected<=0 or p_referral_cost<>expected then raise exception 'INVALID_REFERRAL_COST'; end if;
 select greatest(0,(select count(*) from referrals where referrer_id=p_user_id)+coalesce((select sum(delta) from referral_adjustments where user_id=p_user_id),0))::int into tot;
 select (coalesce((select sum(referral_cost) from referral_redemptions where user_id=p_user_id),0)+coalesce((select sum(refs_spent) from referral_conversions where user_id=p_user_id),0))::int into spent;
 select referral_cost into existing from referral_redemptions where order_id=p_order_id;
 if existing is not null then return query select tot,spent,greatest(0,tot-spent);return;end if;
 if tot-spent<p_referral_cost then raise exception 'INSUFFICIENT_REFERRALS'; end if;
 insert into referral_redemptions(user_id,product_id,order_id,referral_cost) values(p_user_id,p_product_id,p_order_id,p_referral_cost);
 return query select tot,spent+p_referral_cost,tot-spent-p_referral_cost;
end $$;

create or replace function public.create_checkout_order(p_user_id bigint,p_product_id bigint,p_qty integer,p_unit_price numeric,p_total numeric,p_discount numeric,p_promo_id bigint,p_key text,p_kind text default 'wallet',p_allow_preorder boolean default false,p_api_key_id bigint default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u users; p products; o orders; items text[]; b numeric; pre boolean; pool integer;
begin
 if p_kind not in ('wallet','referral','direct','api') or p_key is null or length(p_key)>200 or length(p_key)<1 or p_qty<1 or p_qty>999 or p_total<0 or p_unit_price<0 or p_discount<0 or p_total<>round(p_unit_price*p_qty-p_discount,2) then raise exception 'INVALID_CHECKOUT';end if;
 -- Same lock order as referral conversion, deposit approval and wallet changes.
 perform pg_advisory_xact_lock(p_user_id);
 select * into u from users where telegram_id=p_user_id for update;
 if not found or u.is_banned then raise exception 'USER_UNAVAILABLE';end if;
 select * into o from orders where user_id=p_user_id and checkout_key=p_key;
 if found then if o.product_id<>p_product_id or o.qty<>p_qty or o.total<>p_total then raise exception 'IDEMPOTENCY_CONFLICT';end if;return jsonb_build_object('order',to_jsonb(o),'balance',u.balance,'replayed',true);end if;
 select * into p from products where id=p_product_id for update;
 if not found or not p.active or p.catalog_hidden or p.api_auto_hidden or exists(select 1 from categories where id=p.category_id and not active) then raise exception 'PRODUCT_UNAVAILABLE';end if;
 if p_api_key_id is not null and (not exists(select 1 from reseller_api_keys where id=p_api_key_id and user_id=p_user_id and active) or exists(select 1 from reseller_api_hidden where api_key_id=p_api_key_id and product_id=p_product_id)) then raise exception 'API_KEY_OR_PRODUCT_UNAVAILABLE';end if;
 pre:=not p.unlimited_stock and p.stock<p_qty;
 if pre and not p_allow_preorder then raise exception 'OUT_OF_STOCK';end if;
 insert into orders(user_id,product_id,product_name,qty,unit_price,total,discount,promo_id,checkout_key,is_preorder,fulfillment_state,delivery)
 values(p_user_id,p_product_id,p.name,p_qty,p_unit_price,p_total,p_discount,p_promo_id,p_key,pre,'pending',case when pre then 'Preorder pending' else 'Delivery pending' end) returning * into o;
 b:=u.balance;
 if p_kind in ('wallet','api') then b:=apply_wallet_change(p_user_id,-p_total,'wallet_purchase','order:'||o.id);
 elsif p_kind='referral' then perform * from spend_referral_balance(p_user_id,p_product_id,o.id,p.referral_required_count*p_qty);end if;
 if not pre then
  if not p.unlimited_stock then update products set stock=stock-p_qty where id=p.id;end if;
  select count(*) into pool from product_items where product_id=p.id;
  if pool>0 and not exists(select 1 from supplier_product_links where local_product_id=p.id and auto_order) and coalesce(p.note,'') not like '%[API_PRODUCT_ID:%' then
   with picked as(select id from product_items where product_id=p.id and consumed_at is null order by id for update skip locked limit p_qty), claimed as(update product_items i set consumed_at=now(),consumed_order_id=o.id from picked where i.id=picked.id returning i.payload) select array_agg(payload) into items from claimed;
   if coalesce(cardinality(items),0)<>p_qty then raise exception 'DELIVERY_NOT_READY';end if;
  end if;
  update orders set stock_reserved=true,allocated_items=coalesce(items,'{}') where id=o.id returning * into o;
 end if;
 if p_api_key_id is not null then insert into reseller_api_orders(user_id,api_key_id,order_id,product_id,qty,total,request_id) values(p_user_id,p_api_key_id,o.id,p_product_id,p_qty,p_total,p_key);end if;
 return jsonb_build_object('order',to_jsonb(o),'balance',b,'replayed',false);
end $$;

create or replace function public.claim_product_items(p_product_id bigint,p_qty integer,p_order_id bigint) returns text[] language plpgsql security definer set search_path=public as $$
declare o orders; items text[]; n integer;
begin
 select * into o from orders where id=p_order_id for update;
 if not found or o.product_id<>p_product_id or o.qty<>p_qty or o.status<>'paid' then raise exception 'INVALID_ORDER';end if;
 if cardinality(o.allocated_items)>0 then return o.allocated_items;end if;
 select count(*) into n from product_items where product_id=p_product_id;
 if n=0 then return '{}';end if;
 with picked as(select id from product_items where product_id=p_product_id and consumed_at is null order by id for update skip locked limit p_qty), claimed as(update product_items i set consumed_at=now(),consumed_order_id=p_order_id from picked where i.id=picked.id returning i.payload) select array_agg(payload) into items from claimed;
 if coalesce(cardinality(items),0)<>p_qty then raise exception 'DELIVERY_NOT_READY';end if;
 update orders set allocated_items=items where id=p_order_id;
 return items;
end $$;
create or replace function public.change_product_stock(p_product_id bigint,p_delta integer) returns integer language plpgsql security definer set search_path=public as $$
declare n int;
begin
 update products set stock=stock+p_delta where id=p_product_id and not unlimited_stock and stock+p_delta>=0 returning stock into n;
 if n is null and not exists(select 1 from products where id=p_product_id and unlimited_stock) then raise exception 'OUT_OF_STOCK';end if;
 return n;
end $$;
create or replace function public.product_pool_counts() returns table(product_id bigint,available bigint) language sql stable security definer set search_path=public as $$ select product_id,count(*) from product_items where consumed_at is null group by product_id $$;

create table if not exists public.payment_quotes(id bigserial primary key,user_id bigint not null references public.users(telegram_id),provider text not null,address text not null,base_amount numeric not null check(base_amount>0),exact_amount numeric not null,asset text not null default 'USDT',conversion_rate numeric not null default 1,expires_at timestamptz not null,consumed_by bigint unique);
alter table public.deposits add column if not exists quote_id bigint references public.payment_quotes(id);
alter table public.deposits add column if not exists fulfilled_order_id bigint references public.orders(id);
alter table public.deposits add column if not exists approval_result jsonb;
create or replace function public.reserve_payment_quote(p_user_id bigint,p_provider text,p_address text,p_base numeric,p_asset text default 'USDT',p_rate numeric default 1) returns jsonb language plpgsql security definer set search_path=public as $$
declare q payment_quotes; step numeric; candidate numeric; i int;
begin
 if p_base<=0 or p_base>1000000 or p_rate<=0 or p_asset not in ('USDT','LTC') or length(p_address)<3 then raise exception 'INVALID_QUOTE';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_provider||':'||p_address,0));
 for i in 1..999 loop
  step:=case when p_asset='LTC' then 0.00000001 else 0.0001 end;
  candidate:=case when p_asset='LTC' then round(p_base/p_rate,8) else round(p_base,2) end+i*step;
  if not exists(select 1 from payment_quotes where provider=p_provider and address=p_address and exact_amount=candidate and expires_at>now()) then
   insert into payment_quotes(user_id,provider,address,base_amount,exact_amount,asset,conversion_rate,expires_at) values(p_user_id,p_provider,p_address,p_base,candidate,p_asset,p_rate,now()+case when p_asset='LTC' then interval '10 minutes' else interval '30 minutes' end) returning * into q;
   return to_jsonb(q);
  end if;
 end loop;
 raise exception 'QUOTE_CAPACITY_REACHED';
end $$;
create or replace function public.approve_deposit_atomic(p_id bigint,p_amount numeric,p_tx_hash text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare d deposits; q payment_quotes; checkout jsonb; result jsonb; b numeric; i jsonb; paid numeric; orderid bigint;
begin
 select * into d from deposits where id=p_id;
 if not found then raise exception 'DEPOSIT_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(d.user_id);
 perform 1 from users where telegram_id=d.user_id for update;
 select * into d from deposits where id=p_id for update;
 if d.status='approved' and d.approval_result is not null then return d.approval_result||jsonb_build_object('replayed',true);end if;
 if d.status<>'pending' or p_amount<=0 or p_amount='NaN'::numeric then raise exception 'DEPOSIT_NOT_PENDING_OR_AMOUNT_INVALID';end if;
 if p_tx_hash is not null and exists(select 1 from deposits where id<>d.id and tx_hash=p_tx_hash) then raise exception 'TRANSACTION_ALREADY_USED';end if;
 paid:=p_amount;
 if d.quote_id is not null then
  select * into q from payment_quotes where id=d.quote_id for update;
  if q.user_id<>d.user_id or q.consumed_by is not null and q.consumed_by<>d.id then raise exception 'QUOTE_OWNERSHIP';end if;
  if q.asset='USDT' and abs(p_amount-q.exact_amount)>0.0000001 then raise exception 'PAYMENT_AMOUNT_MISMATCH';end if;
  if q.asset='LTC' and abs(p_amount-q.base_amount)>0.01 then raise exception 'PAYMENT_AMOUNT_MISMATCH';end if;
  update payment_quotes set consumed_by=d.id where id=q.id;
 end if;
 if d.order_intent is not null then
  i:=d.order_intent;
  if paid<(i->>'total')::numeric then raise exception 'INSUFFICIENT_PAYMENT';end if;
  if exists(select 1 from products where id=(i->>'product_id')::bigint and active and not catalog_hidden and not api_auto_hidden and (category_id is null or exists(select 1 from categories where id=products.category_id and active))) then
   checkout:=create_checkout_order(d.user_id,(i->>'product_id')::bigint,(i->>'qty')::int,(i->>'unit_price')::numeric,(i->>'total')::numeric,coalesce((i->>'discount')::numeric,0),(i->>'promo_id')::bigint,'deposit:'||d.id,'direct',true);
   orderid:=(checkout->'order'->>'id')::bigint;
   paid:=greatest(0,paid-(i->>'total')::numeric);
  end if;
 end if;
 if round(paid,2)>0 then b:=apply_wallet_change(d.user_id,round(paid,2),'deposit_credit','deposit:'||d.id);else select balance into b from users where telegram_id=d.user_id;end if;
 result:=jsonb_build_object('balance',b,'order',checkout->'order','refunded',d.order_intent is not null and orderid is null,'replayed',false);
 update deposits set status='approved',amount=round(p_amount,2),tx_hash=coalesce(p_tx_hash,tx_hash),fulfilled_order_id=orderid,approval_result=result,updated_at=now() where id=d.id;
 return result;
end $$;
create or replace function public.redeem_gift_atomic(p_user_id bigint,p_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare g gift_codes; b numeric;
begin
 select * into g from gift_codes where code=p_code for update;
 if not found or g.amount<=0 or g.expires_at<=now() then raise exception 'GIFT_UNAVAILABLE';end if;
 if (g.max_redemptions is not null and (select count(*) from gift_code_redemptions where code=p_code)>=g.max_redemptions) or (select count(*) from gift_code_redemptions where code=p_code and user_id=p_user_id)>=g.per_user_limit then raise exception 'GIFT_LIMIT';end if;
 b:=adjust_balance(p_user_id,g.amount);
 insert into gift_code_redemptions(code,user_id,amount) values(p_code,p_user_id,g.amount);
 insert into wallet_ledger(user_id,type,amount,reference) values(p_user_id,'gift_credit',g.amount,p_code);
 return jsonb_build_object('amount',g.amount,'balance',b);
end $$;
create table if not exists public.supplier_order_attempts(order_id bigint primary key references public.orders(id),state text not null default 'pending',result jsonb,created_at timestamptz not null default now());
create table if not exists public.delivery_form_sessions(user_id bigint primary key, data jsonb not null,updated_at timestamptz not null default now());

create or replace function public.begin_order_delivery(p_order_id bigint) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update orders set fulfillment_state='processing',delivery_lease_until=now()+interval '5 minutes' where id=p_order_id and status='paid' and (fulfillment_state='pending' or fulfillment_state='processing' and delivery_lease_until<now());
 return found;
end $$;
create or replace function public.pending_checkout_deliveries() returns setof public.orders language sql stable security definer set search_path=public as $$ select * from orders where checkout_key is not null and status='paid' and (fulfillment_state='pending' or fulfillment_state='processing' and delivery_lease_until<now()) order by id limit 25 $$;

create or replace function public.tenant_registry_mutation(p_action text,p_id text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare tenant jsonb; ids jsonb; stamp timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('tenant:registry',0));
 select value into tenant from settings where key='tenant:'||p_id;
 select coalesce(value,'[]') into ids from settings where key='tenant:list';ids:=coalesce(ids,'[]');
 if p_action='add' then
  if tenant is not null then raise exception 'TENANT_EXISTS';end if;
  if p_payload->>'id'<>p_id then raise exception 'INVALID_TENANT';end if;
  tenant:=p_payload;
  if not ids ? p_id then ids:=ids||to_jsonb(p_id);end if;
 elsif p_action='delete' then
  delete from settings where key='tenant:'||p_id;
  select coalesce(jsonb_agg(v),'[]') into ids from jsonb_array_elements(ids) v where v<>to_jsonb(p_id);
 elsif tenant is null then raise exception 'TENANT_NOT_FOUND';
 elsif p_action='status' then
  if p_payload->>'status' not in ('active','suspended','expired') then raise exception 'INVALID_TENANT_STATUS';end if;
  tenant:=tenant||jsonb_build_object('status',p_payload->>'status','updated_at',now());
 elsif p_action='extend' then
  if (p_payload->>'days')::int<1 then raise exception 'INVALID_DAYS';end if;
  stamp:=greatest((tenant->>'subscription_end')::timestamptz,now())+(p_payload->>'days')::int*interval '1 day';
  tenant:=tenant||jsonb_build_object('subscription_end',stamp,'status','active','updated_at',now());
 else raise exception 'INVALID_TENANT_ACTION';end if;
 if p_action<>'delete' then insert into settings(key,value) values('tenant:'||p_id,tenant) on conflict(key) do update set value=excluded.value;end if;
 insert into settings(key,value) values('tenant:list',ids) on conflict(key) do update set value=excluded.value;
 return tenant;
end $$;

create or replace function public.shop_statistics(p_user_id bigint default null,p_days integer default null) returns jsonb language sql stable security definer set search_path=public as $$
 with paid as(select * from orders where status='paid' and (p_user_id is null or user_id=p_user_id) and (p_days is null or created_at>=now()-greatest(1,least(365,p_days))*interval '1 day')),
 credited as(select * from deposits where status='approved' and (p_user_id is null or user_id=p_user_id) and (p_days is null or created_at>=now()-greatest(1,least(365,p_days))*interval '1 day'))
 select jsonb_build_object('users',(select count(*) from users),'orders',(select count(*) from paid),'revenue',coalesce((select sum(total) from paid),0),'spent',coalesce((select sum(total) from paid),0),'items',coalesce((select sum(qty) from paid),0),'units',coalesce((select sum(qty) from paid),0),'lastOrderAt',(select max(created_at) from paid),'deposits',coalesce((select sum(amount) from credited),0),'pending_deposits',(select count(*) from deposits where status='pending'),'active_products',(select count(*) from products where active and not catalog_hidden and not api_auto_hidden),'active_categories',(select count(*) from categories where active),'days',p_days,'unique_buyers',(select count(distinct user_id) from paid),'approved_deposits',(select count(*) from credited),'deposit_amount',coalesce((select sum(amount) from credited),0),'new_users',(select count(*) from users where p_days is null or joined_at>=now()-greatest(1,least(365,p_days))*interval '1 day'))
$$;
create or replace function public.product_sales_statistics(p_days integer default null,p_limit integer default 50) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select o.product_id,coalesce(p.name,max(o.product_name)) as product_name,count(*) as orders,sum(o.qty) as units_sold,sum(o.total) as revenue,max(o.created_at) as last_sold_at,p.stock as stock_left from orders o left join products p on p.id=o.product_id where o.status='paid' and (p_days is null or o.created_at>=now()-greatest(1,least(365,p_days))*interval '1 day') group by o.product_id,case when o.product_id is null then o.product_name else null end,p.name,p.stock order by revenue desc limit greatest(1,least(500,p_limit))) r
$$;
create or replace function public.reserve_preorder_stock(p_order_id bigint) returns boolean language plpgsql security definer set search_path=public as $$
declare o orders; p products;
begin
 select * into o from orders where id=p_order_id for update;
 if not found or o.status<>'paid' then return false;end if;
 if o.stock_reserved then return true;end if;
 select * into p from products where id=o.product_id for update;
 if not found or not p.active or p.catalog_hidden or p.api_auto_hidden or not p.unlimited_stock and p.stock<o.qty then return false;end if;
 if not p.unlimited_stock then update products set stock=stock-o.qty where id=p.id;end if;
 update orders set stock_reserved=true where id=o.id;return true;
end $$;
create or replace function public.release_preorder_stock(p_order_id bigint) returns void language plpgsql security definer set search_path=public as $$
declare o orders;
begin
 select * into o from orders where id=p_order_id for update;
 if o.stock_reserved and o.fulfillment_state<>'delivered' then update products set stock=stock+o.qty where id=o.product_id and not unlimited_stock;update orders set stock_reserved=false where id=o.id;end if;
end $$;

create or replace function public.api_account_statistics(p_user_id bigint) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('total_orders',count(*),'completed_orders',count(*) filter(where o.fulfillment_state='delivered' or o.fulfillment_state='legacy'),'pending_orders',count(*) filter(where o.fulfillment_state not in ('delivered','legacy')),'total_revenue',coalesce(sum(a.total) filter(where o.status='paid'),0)) from reseller_api_orders a join orders o on o.id=a.order_id where a.user_id=p_user_id
$$;

-- No browser/client role can invoke privileged financial RPCs or inspect secret-bearing tables.
do $$ declare t text; f record; begin
 foreach t in array array['wallet_ledger','gift_codes','gift_code_redemptions','user_price_overrides','promos','reseller_api_keys','reseller_api_orders','supplier_api_sources','supplier_product_links','supplier_order_logs','wallet_operations','payment_quotes','rate_limits','delivery_form_sessions','supplier_order_attempts','runtime_versions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
 revoke all on public.products_view from anon,authenticated;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.proname in ('bump_runtime_version','runtime_revisions','runtime_settings_snapshot','catalog_availability','adjust_balance','apply_wallet_change','consume_rate_limit','referral_setting','confirm_referral_atomic','convert_referrals_to_wallet','spend_referral_balance','create_checkout_order','claim_product_items','change_product_stock','product_pool_counts','reserve_payment_quote','approve_deposit_atomic','redeem_gift_atomic','begin_order_delivery','pending_checkout_deliveries','tenant_registry_mutation','shop_statistics','product_sales_statistics','reserve_preorder_stock','release_preorder_stock','api_account_statistics') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
