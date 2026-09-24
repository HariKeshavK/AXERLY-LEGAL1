-- AXERLY modified 2026-09-24.
-- Metadata for ciphertext stored on the host filesystem. Names and MIME types
-- remain in their owning domain tables; no user-controlled value is a path.

create table if not exists public.stored_files (
  id uuid primary key,
  owner_id uuid not null,
  logical_key text unique,
  logical_key_sha256 text unique,
  resource_kind text not null default 'user'
    check (resource_kind in ('user', 'document', 'project', 'library', 'system')),
  resource_id uuid,
  wrapped_data_key bytea not null,
  wrap_nonce bytea not null,
  wrap_tag bytea not null,
  nonce_prefix bytea not null,
  frame_size integer not null check (frame_size between 16384 and 4194304),
  plaintext_size bigint not null check (plaintext_size >= 0),
  plaintext_sha256 text not null,
  created_at timestamptz not null default now()
);

create index if not exists stored_files_owner_idx on public.stored_files(owner_id);
create index if not exists stored_files_resource_idx on public.stored_files(resource_kind, resource_id);
grant select, insert, update, delete on public.stored_files to axerly_app;

-- Large local uploads remain streamed through the API. Raise the former
-- object-store cap without changing the historical migration checksum.
alter table public.upload_session_files drop constraint if exists upload_session_files_size_check;
alter table public.upload_session_files add constraint upload_session_files_size_check
  check (expected_size_bytes between 1 and 268435456);

do $migration$
declare definition text;
begin
  select pg_get_functiondef(
    'public.create_upload_session(uuid,uuid,text,jsonb,timestamptz,jsonb,integer)'::regprocedure
  ) into definition;
  if position('file_row.expected_size_bytes not between 1 and 104857600' in definition) = 0 then
    raise exception 'Unexpected upload session function: cannot migrate file size limit';
  end if;
  execute replace(definition,
    'file_row.expected_size_bytes not between 1 and 104857600',
    'file_row.expected_size_bytes not between 1 and 268435456');
end $migration$;
