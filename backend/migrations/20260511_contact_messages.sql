-- AXERLY modified 2026-09-23.
-- Migration date: 2026-05-11

-- Store landing-page contact form submissions.
-- The landing server route writes with the Supabase service role; browser
-- public/axerly_app roles should not have direct table access.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  subject text,
  message text not null,
  source text not null default 'landing',
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists idx_contact_messages_created_at
  on public.contact_messages(created_at desc);
revoke all privileges on table public.contact_messages
  from public;
