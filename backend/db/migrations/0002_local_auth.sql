-- AXERLY authentication/session hardening. AXERLY modified 2026-09-24.
alter table public.users
  add column if not exists failed_login_attempts integer not null default 0,
  add column if not exists locked_until timestamptz;

drop table if exists public.auth_handoff_tickets;

create table if not exists public.auth_bootstrap_guard (
  singleton boolean primary key default true check (singleton)
);
insert into public.auth_bootstrap_guard(singleton)
select true where exists (select 1 from public.users)
on conflict do nothing;

do $$
begin
  if to_regclass('public.sessions') is null and to_regclass('public.auth_sessions') is not null then
    alter table public.auth_sessions rename to sessions;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sessions' and column_name='expires_at')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='sessions' and column_name='absolute_expires_at') then
    alter table public.sessions rename column expires_at to absolute_expires_at;
  end if;
end
$$;
alter table public.sessions
  add column if not exists idle_expires_at timestamptz,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists csrf_token_hash text;
update public.sessions set idle_expires_at = least(absolute_expires_at, now() + interval '30 minutes') where idle_expires_at is null;
delete from public.sessions where csrf_token_hash is null;
alter table public.sessions alter column idle_expires_at set not null, alter column csrf_token_hash set not null;

drop index if exists public.auth_sessions_user_active_idx;
create index if not exists sessions_user_active_idx on public.sessions(user_id, idle_expires_at, absolute_expires_at) where revoked_at is null;

create or replace function public.revoke_user_sessions_on_security_change()
returns trigger language plpgsql as $$
begin
  if old.password_hash is distinct from new.password_hash or old.role is distinct from new.role or old.status is distinct from new.status then
    update public.sessions set revoked_at = now() where user_id = new.id and revoked_at is null;
  end if;
  return new;
end
$$;
drop trigger if exists revoke_user_sessions_on_security_change on public.users;
create trigger revoke_user_sessions_on_security_change after update of password_hash, role, status on public.users
for each row execute function public.revoke_user_sessions_on_security_change();
