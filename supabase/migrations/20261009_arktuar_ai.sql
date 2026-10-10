-- aRKtuar AI: allowlist + daily quota for the AI proxy.
-- No document content is ever stored; only who called and how many times per day.

create table if not exists public.arktuar_allowlist (
  email       text primary key,
  daily_limit int  not null default 60,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.arktuar_usage (
  user_id uuid not null,
  day     date not null default (now() at time zone 'Asia/Jerusalem')::date,
  calls   int  not null default 0,
  primary key (user_id, day)
);

-- Locked down: RLS on and no policies, so only the service role (the Edge Function) can touch them.
alter table public.arktuar_allowlist enable row level security;
alter table public.arktuar_usage     enable row level security;
revoke all on public.arktuar_allowlist from anon, authenticated;
revoke all on public.arktuar_usage     from anon, authenticated;

-- Atomically consume one call; returns the new count, or -1 when the limit is reached.
create or replace function public.arktuar_consume(p_user uuid, p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day   date := (now() at time zone 'Asia/Jerusalem')::date;
  v_calls int;
begin
  insert into public.arktuar_usage as u (user_id, day, calls)
  values (p_user, v_day, 1)
  on conflict (user_id, day) do update
    set calls = u.calls + 1
    where u.calls < p_limit
  returning calls into v_calls;
  return coalesce(v_calls, -1);
end;
$$;

revoke all on function public.arktuar_consume(uuid, int) from public, anon, authenticated;

-- Owner access
insert into public.arktuar_allowlist (email, daily_limit, note)
values ('barazanierez@gmail.com', 200, 'owner')
on conflict (email) do nothing;
