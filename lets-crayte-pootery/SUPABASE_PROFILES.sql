-- ============================================================
-- profiles table + auth trigger — SQL migration
-- ============================================================
-- ROOT CAUSE this fixes: the Postgres logs showed
--   ERROR: relation "profiles" does not exist
-- on every magic-link / Google signup. The Phase-1 profiles
-- schema was never actually applied to this Supabase project
-- (or got dropped), so the handle_new_user trigger -- and the
-- app's profile reads/writes -- all fail.
--
-- This script is idempotent: safe to run repeatedly. It
-- creates the table, RLS policies, the signup trigger, and
-- backfills profile rows for any auth.users that predate it.
--
-- Column set reconstructed from lets-crayte-pootery/game.js:
--   fetchProfile     -> select *
--   updateProfile    -> patch {username, display_name, bio, updated_at}
--   profile pages    -> select * where username = <handle>
--   enrichWithProfiles -> select id, username, display_name
--   pack ownership   -> profiles.owned_packs (text[])
-- avatar_pot_id + tip_total_cents are kept nullable for
-- forward-compat with the original Phase-1 design even though
-- the current client doesn't read them yet.
-- ============================================================

create table if not exists public.profiles (
    id              uuid primary key
                    references auth.users (id) on delete cascade,
    username        text unique,
    display_name    text,
    bio             text,
    avatar_pot_id   uuid,
    owned_packs     text[] not null default '{}',
    tip_total_cents integer not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- Username format guard (3-20 chars, lowercase/digits/underscore)
-- mirrors the client-side check in game.js. NULL allowed so a
-- fresh account has no handle until the user picks one.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'profiles_username_format'
    ) then
        alter table public.profiles
            add constraint profiles_username_format
            check (username is null or username ~ '^[a-z0-9_]{3,20}$');
    end if;
end $$;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles enable row level security;

-- Anyone (anon + authenticated) can READ any profile. Public
-- profile pages + enrichWithProfiles bylines need this.
drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
on public.profiles
for select
to anon, authenticated
using (true);

-- A signed-in user can UPDATE only their own row.
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- A signed-in user may INSERT their own row (fallback if the
-- trigger ever doesn't fire; normally the trigger handles it).
drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

-- ============================================================
-- Signup trigger — auto-create a profile row for every new
-- auth.users row. SECURITY DEFINER so it bypasses RLS;
-- explicit search_path so it can't be hijacked. on conflict
-- do nothing makes it safe if a row somehow already exists.
-- Only `id` is inserted; every other column is nullable or
-- has a default, so this never fails on a NOT NULL.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id)
    values (new.id)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- ============================================================
-- Backfill: any existing auth.users without a profile row
-- (e.g. accounts created via Google before this script ran)
-- get one now so they aren't permanently profile-less.
-- ============================================================
insert into public.profiles (id)
select u.id
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- ============================================================
-- Done. After this runs, magic-link + Google signup both
-- succeed: the auth.users insert no longer aborts because the
-- trigger now inserts into a table that exists.
-- ============================================================
