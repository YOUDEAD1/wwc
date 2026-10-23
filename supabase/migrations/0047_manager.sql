-- Dedicated management bot. Existing store data and NSS balances are not moved.
begin;
create table if not exists public.wwc_manager_users(
 telegram_id bigint primary key check(telegram_id>0),
 language text not null default 'en' check(language in('en','ar','vi','zh')),
 language_chosen boolean not null default false,
 draft_box text,
 draft_expires_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.wwc_manager_users enable row level security;
revoke all on public.wwc_manager_users from public,anon,authenticated;
grant all on public.wwc_manager_users to service_role;
create or replace function public.wwc_manager_overview() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('total',count(*),'active',count(*) filter(where status='active'),
 'paid',count(*) filter(where plan='paid' and paid_until>now()),
 'free',count(*) filter(where not(plan='paid' and coalesce(paid_until,'epoch')>now())),
 'other',count(*) filter(where status<>'active')) from wwc_platform_shops
$$;
revoke all on function public.wwc_manager_overview() from public,anon,authenticated;
grant execute on function public.wwc_manager_overview() to service_role;
-- Bound expired secret draft retention even when a user never returns.
create or replace function public.wwc_manager_cleanup() returns void language sql security definer set search_path=public as $$
 update wwc_manager_users set draft_box=null,draft_expires_at=null where draft_expires_at<now() and draft_box is not null
$$;
revoke all on function public.wwc_manager_cleanup() from public,anon,authenticated;
grant execute on function public.wwc_manager_cleanup() to service_role;
commit;
