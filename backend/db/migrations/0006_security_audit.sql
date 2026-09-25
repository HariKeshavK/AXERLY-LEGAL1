-- AXERLY modified 2026-09-25.
-- Anonymous security events cannot enter audit_events (user_id NOT NULL).
-- Never store credential values, request bodies, raw IP addresses or titles.
create table public.security_audit_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid references public.users(id) on delete set null,
  ip_hash text not null check (length(ip_hash) = 64),
  action text not null check (length(action) between 1 and 80),
  http_status integer not null check (http_status between 100 and 599),
  target_kind text check (length(target_kind) <= 40),
  target_id text check (length(target_id) <= 128)
);
create index security_audit_events_created_idx on public.security_audit_events(created_at desc);
create index security_audit_events_actor_idx on public.security_audit_events(actor_id, created_at desc);
grant select, insert, delete on public.security_audit_events to axerly_app;
grant usage, select on sequence public.security_audit_events_id_seq to axerly_app;
