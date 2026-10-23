-- Preserve the current bot username and owner language when rotating credentials.
begin;
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
  update wwc_platform_shops set secret_box=p_payload->>'secret_box',token_fingerprint=p_payload->>'token_fingerprint',database_fingerprint=p_payload->>'database_fingerprint',bot_username=coalesce(p_payload->>'bot_username',bot_username),owner_lang=coalesce(p_payload->>'owner_lang',owner_lang),status=case when status in('locked','suspended') then status else 'setup' end where id=p_id;
 else raise exception 'INVALID_ACTION';end if;
 update wwc_platform_shops set updated_at=now() where id=p_id returning * into s;
 delete from wwc_platform_events where kind='customer' and created_at<now()-interval '7 days';return to_jsonb(s);
end $$;
commit;
