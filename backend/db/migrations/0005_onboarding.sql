-- AXERLY modified 2026-09-25.
-- Join credentials remain in firm_settings, never in organizations responses.
alter table public.users add column must_change_password boolean not null default false;
create table public.join_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  token_hash text not null unique,
  ip_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index join_tokens_expiry_idx on public.join_tokens(expires_at);

create table public.join_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index join_attempts_ip_recent_idx on public.join_attempts(ip_hash, created_at desc);
create index join_attempts_recent_idx on public.join_attempts(created_at desc);

-- A single row serializes first-firm creation and global join backoff.
create table public.onboarding_guard (
  singleton boolean primary key default true check (singleton),
  failed_join_count integer not null default 0,
  join_blocked_until timestamptz
);
insert into public.onboarding_guard(singleton) values(true);

grant select, insert, update, delete on public.join_tokens, public.join_attempts,
  public.onboarding_guard to axerly_app;
grant usage, select on sequence public.join_attempts_id_seq to axerly_app;
