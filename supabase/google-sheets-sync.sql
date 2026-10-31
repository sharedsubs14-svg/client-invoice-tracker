-- Google Sheets background sync.
-- Run once in Supabase → SQL Editor → New query, AFTER schema.sql.
-- Every insert / update / delete on public.entries is posted to your Google Apps Script
-- web app (see docs/google-sheets-sync.md), which keeps the Google Sheet up to date.
-- Nothing here is reachable from the app or the public API.

-- 1. pg_net lets Postgres make outgoing HTTP calls (asynchronously, so saves stay fast).
create extension if not exists pg_net;

-- 2. Private schema for the sync settings. It's not exposed through the API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.sheets_config (
  id int primary key default 1 check (id = 1),   -- single row
  url text not null,                              -- Apps Script web app URL (ends in /exec)
  secret text not null,                           -- shared secret, same as SECRET in Apps Script
  enabled boolean not null default true
);
revoke all on private.sheets_config from public, anon, authenticated;

-- 3. Trigger function: send the changed entry to the sheet.
create or replace function private.sheets_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg private.sheets_config;
  payload jsonb;
begin
  select * into cfg from private.sheets_config where id = 1;
  if cfg is null or not cfg.enabled then
    return null;
  end if;

  if tg_op = 'DELETE' then
    payload := jsonb_build_object('type', 'DELETE', 'id', old.id, 'secret', cfg.secret);
  else
    payload := jsonb_build_object('type', 'UPSERT', 'id', new.id, 'record', new.data, 'secret', cfg.secret);
  end if;

  perform net.http_post(
    url := cfg.url,
    body := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000
  );
  return null;
end;
$$;

drop trigger if exists entries_to_sheets on public.entries;
create trigger entries_to_sheets
  after insert or update or delete on public.entries
  for each row execute function private.sheets_notify();

-- 4. Full resync: sends every entry and rebuilds the sheet from scratch.
--    Run it any time with:  select private.sheets_resync();
create or replace function private.sheets_resync()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg private.sheets_config;
  n int;
begin
  select * into cfg from private.sheets_config where id = 1;
  if cfg is null then
    return 'No sheet configured yet - run step 5 first.';
  end if;
  select count(*) into n from public.entries;
  perform net.http_post(
    url := cfg.url,
    body := jsonb_build_object(
      'type', 'RESYNC',
      'secret', cfg.secret,
      'records', (select coalesce(jsonb_agg(e.data), '[]'::jsonb) from public.entries e)
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  );
  return format('Sent %s entries to the sheet.', n);
end;
$$;
revoke all on function private.sheets_notify() from public, anon, authenticated;
revoke all on function private.sheets_resync() from public, anon, authenticated;

-- 5. Paste your Apps Script URL and secret, then run this part (re-run it to change them).
--    insert into private.sheets_config (id, url, secret)
--    values (1, 'https://script.google.com/macros/s/XXXXXXXX/exec', 'your-long-random-secret')
--    on conflict (id) do update set url = excluded.url, secret = excluded.secret, enabled = true;
--
--    Then copy everything already in the app into the sheet:
--    select private.sheets_resync();
--
-- Check recent deliveries (status 302 or 200 = delivered; Apps Script replies with a redirect):
--    select id, status_code, created from net._http_response order by created desc limit 10;
-- Pause syncing:   update private.sheets_config set enabled = false;
