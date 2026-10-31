-- Run this in Supabase → SQL Editor → New query. Safe to run again at any time.
-- Each entry (quote → paid) is one row. Its `data` is encrypted on the user's device
-- (js/crypto.js), so the database only ever holds ciphertext: {"v":1,"iv":"…","ct":"…"}.

-- 0. Remove the old Google Sheets sync, if it was ever installed (it sent readable data out).
drop trigger if exists entries_to_sheets on public.entries;
drop function if exists private.sheets_notify();
drop function if exists private.sheets_resync();
drop table if exists private.sheets_config;
drop schema if exists private;
drop extension if exists pg_net;

-- 1. Tables
create table if not exists public.entries (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- The user's data key, wrapped (encrypted) by their password and by their recovery code.
-- Useless without one of those two secrets, which never leave the user's device.
create table if not exists public.user_keys (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists entries_user_id_idx on public.entries (user_id);

-- 2. Row Level Security: every login can only see and change its own rows.
alter table public.entries enable row level security;
alter table public.settings enable row level security;
alter table public.user_keys enable row level security;

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own keys" on public.user_keys;
create policy "own keys" on public.user_keys
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Logged-out visitors get nothing at all.
revoke all on public.entries, public.settings, public.user_keys from anon;

-- 3. Refuse readable data: every new or changed row must be encrypted.
--    (NOT VALID = rows saved before encryption are left alone; the app re-encrypts them on next sign-in.)
alter table public.entries drop constraint if exists entries_encrypted;
alter table public.entries add constraint entries_encrypted check (data ? 'ct' and data ? 'iv') not valid;
alter table public.settings drop constraint if exists settings_encrypted;
alter table public.settings add constraint settings_encrypted check (data ? 'ct' and data ? 'iv') not valid;
