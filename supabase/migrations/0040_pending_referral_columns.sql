-- Add pending referral tracking columns to users table
-- These are used to defer referral confirmation until the user
-- has verified their channel subscription (force-sub flow).

alter table public.users
  add column if not exists pending_referral_by bigint default null,
  add column if not exists sub_verified boolean not null default false;
