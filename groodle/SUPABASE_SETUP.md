# Groodle public-gallery setup

This file walks you (or a grown-up) through wiring `groodle/` to a
Supabase project so the SAVE / GALLERY buttons in-game actually work.
Until the steps below are complete, both buttons render but display a
"not configured yet" message; the rest of the game keeps working.

## What gets stored

- **`groodle-art` storage bucket** — one PNG per save (anonymous upload,
  public read). Files are named `groodle-{ts}-{rand}.png`.
- **`groodles` table** — one row per save with the kid-chosen display
  name, public image URL, optional coloring-book page id, and the
  server timestamp.

No accounts, no emails, no IPs stored. Names are filtered both
client-side (`isNameClean` in `game.js`) and server-side (the RLS
policy below).

## 1. Create the project

1. Sign in at <https://supabase.com> and create a new project.
2. Pick a region close to your players. Free tier is plenty for this.
3. Wait for provisioning to finish.
4. From **Project Settings → API**, copy two values:
   - **Project URL** (looks like `https://xxxxxxxxxxxxxxxxxxxx.supabase.co`)
   - **anon `public` key** (a long JWT — the *public* one; never the
     `service_role` key)

These are safe to ship in the client code — that's literally what they
are for. The Row Level Security policies in step 3 are what actually
protect the data.

## 2. Paste credentials into the game

Open `groodle/game.js` and find this block near the top of the
`PUBLIC GALLERY (Supabase)` section:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Replace both placeholder strings with the values from step 1. Commit
and push — that's all the client side needs.

## 3. Create the table + bucket + policies

Open **SQL Editor** in the Supabase dashboard, paste the entire block
below, run it once. It is idempotent — re-running won't duplicate
rows or break anything if the schema already exists.

```sql
-- =========================================================
-- groodle gallery: schema + RLS + storage policies
-- =========================================================

-- Table that holds one row per submitted Groodle.
create table if not exists public.groodles (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    image_url   text not null,
    page_id     text,
    created_at  timestamptz not null default now()
);

-- Index for the recent-first gallery query.
create index if not exists groodles_created_at_idx
    on public.groodles (created_at desc);

-- Lock down by default; the policies below open up exactly the
-- operations the public client should be able to perform.
alter table public.groodles enable row level security;

-- Anyone can READ rows (public gallery).
drop policy if exists "groodles_read_public" on public.groodles;
create policy "groodles_read_public"
    on public.groodles for select
    using (true);

-- Anonymous INSERT, with server-side guards:
--   * name length 1..24
--   * name passes a simple profanity regex
--   * image_url must live in our public bucket
drop policy if exists "groodles_insert_anon" on public.groodles;
create policy "groodles_insert_anon"
    on public.groodles for insert
    with check (
        char_length(trim(name)) between 1 and 24
        and name !~* '(fuck|shit|bitch|cunt|nigger|faggot|slut|whore|asshole|dick|penis|vagina|porn|nazi|rape|retard)'
        and image_url like 'https://%/storage/v1/object/public/groodle-art/%'
    );

-- No UPDATE / DELETE from the public client. Moderation happens via
-- the dashboard or a service-role-only admin path.

-- =========================================================
-- Storage bucket for the PNG snapshots.
-- =========================================================

-- Create the bucket if it doesn't exist, public read enabled.
insert into storage.buckets (id, name, public)
values ('groodle-art', 'groodle-art', true)
on conflict (id) do update set public = true;

-- Anonymous uploads, but only to the groodle-art bucket and only with
-- a .png extension. (Storage policies live on storage.objects.)
drop policy if exists "groodle_upload_anon" on storage.objects;
create policy "groodle_upload_anon"
    on storage.objects for insert
    with check (
        bucket_id = 'groodle-art'
        and lower(right(name, 4)) = '.png'
    );

-- Public read of the same bucket.
drop policy if exists "groodle_read_public" on storage.objects;
create policy "groodle_read_public"
    on storage.objects for select
    using (bucket_id = 'groodle-art');
```

## 4. Test it

1. Reload `groodle/` in your browser.
2. Draw something.
3. Tap **💾 SAVE**, accept the random name, hit **Save to Gallery**.
   Status should flip to "Saved! Find it in the Gallery." within a
   second or two.
4. Tap **🖼️ Gallery** in the left HUD — your Groodle should appear at
   the top of the grid.
5. From a private window / different device, open the gallery — same
   image should be visible there too.

## 5. Day-to-day moderation

The public client can't delete or hide rows. To take something down:

- In the dashboard, open **Table editor → groodles**, find the row,
  delete it.
- Or run from SQL editor: `delete from public.groodles where id = '...';`
- The orphaned PNG in `groodle-art` is harmless (and free-tier-cheap),
  but you can delete it from **Storage → groodle-art** if you want to
  reclaim the bytes.

If you want a self-serve report flow later, the cleanest add is a
second table `groodle_reports (groodle_id, reason, created_at)` with
an anon-INSERT policy + an admin-only `select`. The client can post a
report from each gallery card; you triage by querying the report
table. Out of scope for the initial setup.

## 6. Common gotchas

- **403 on insert**: usually means a name failed the profanity regex
  or the `image_url` doesn't match the LIKE pattern. Check
  `select name, image_url from groodles order by created_at desc limit 5`
  to see what the regex is rejecting.
- **CORS errors on upload**: storage is enabled but the bucket is
  *private*. Re-run the bucket upsert in step 3 — `public = true` is
  the load-bearing bit.
- **"not configured yet" still showing after pasting credentials**:
  reload with cache cleared (DevTools → Network → Disable cache); the
  old `game.js` is sticky on GitHub Pages.
- **Gallery feels slow on phones**: each card is a separate
  `<img loading="lazy">`. The PNGs are ~30–60 KB; if many kids submit
  fast and the grid feels heavy, lower the `.limit(48)` in
  `loadRecentGroodles()` or add `transform=cover` parameters to the
  Supabase image URL.
