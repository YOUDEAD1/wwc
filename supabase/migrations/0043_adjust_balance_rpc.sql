-- 0043_adjust_balance_rpc.sql
-- RPC to atomically adjust user balance

create or replace function public.adjust_balance(
    p_telegram_id bigint,
    p_delta numeric
)
returns numeric
security definer
language plpgsql
as $$
declare
    v_new_balance numeric;
begin
    update public.users
    set balance = coalesce(balance, 0) + p_delta
    where telegram_id = p_telegram_id
    returning balance into v_new_balance;

    if v_new_balance is null then
        raise exception 'user_not_found:%', p_telegram_id;
    end if;

    return v_new_balance;
end;
$$;

grant execute on function public.adjust_balance(bigint, numeric) to anon, authenticated, service_role;
