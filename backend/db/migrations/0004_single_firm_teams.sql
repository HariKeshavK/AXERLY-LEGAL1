-- AXERLY modified 2026-09-24.
-- Keep the historical organization id as the firm/tenant id. Reparenting
-- multiple old tenants without per-resource grants would expose private data.
do $migration$
begin
  if (select count(*) from public.organizations) > 1 then
    raise exception 'AXERLY P5 requires a single legacy organization; migrate multiple organizations with an explicit access-preserving plan first';
  end if;
end $migration$;

-- Secret join material lives away from the existing organizations SELECT *
-- call sites, which return their rows to clients.
create table public.firm_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  name text not null,
  org_code text unique,
  org_password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint firm_join_credentials_pair
  check ((org_code is null) = (org_password_hash is null))
);
insert into public.firm_settings(org_id, name)
select id, name from public.organizations;

create function public.sync_firm_settings_name() returns trigger
language plpgsql as $$
begin
  insert into public.firm_settings(org_id, name)
  values (new.id, new.name)
  on conflict (org_id) do update
    set name = excluded.name, updated_at = now();
  return new;
end $$;
create trigger organizations_firm_settings_name
  after insert or update of name on public.organizations
  for each row execute function public.sync_firm_settings_name();
-- Constant-expression uniqueness holds even for direct SQL writes and races.
create unique index organizations_single_firm_unique
  on public.organizations ((true));

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create unique index teams_org_name_unique on public.teams(org_id, lower(btrim(name)));

create table public.team_members (
  team_id uuid not null,
  org_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id),
  foreign key (team_id, org_id) references public.teams(id, org_id) on delete cascade,
  foreign key (org_id, user_id) references public.org_members(org_id, user_id) on delete cascade
);
create index team_members_user_idx on public.team_members(user_id);
create index team_members_org_idx on public.team_members(org_id);

grant select, insert, update, delete on public.firm_settings, public.teams, public.team_members to axerly_app;
