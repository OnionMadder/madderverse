-- ============================================================
-- v1.1 "store the recipe" columns — SQL migration
-- ============================================================
-- Run this once in the Supabase SQL editor. Adds two columns to
-- BOTH public_pots and battle_entries so shared pots carry their
-- v1.1 decoration data as DATA instead of a baked-flat image:
--
--   surface_texture_pack_id  — which pack's surface skin (the
--                              TEXTURE button) is applied. A short
--                              pack id like 'plushie' / 'space'.
--   stickers                 — the vector sticker records (jsonb):
--                              [{pattern,x,y,r,rot,flipH,color}, ...]
--
-- WHY: before this, the only place to store a shared pot's look
-- was the single paint_data_url image column, so game.js BAKED
-- the texture + stickers flat into that PNG. Baked = the gallery
-- couldn't light the texture correctly (the lighting layer ends
-- up UNDER the baked image) and the stickers couldn't spin in the
-- detail view. With these columns, public pots render through the
-- exact same live pipeline as local pots: texture lit on top,
-- stickers spinnable, smaller upload payload.
--
-- FORWARD/BACKWARD COMPAT: game.js uses a "recipe first, bake on
-- fallback" upload. It tries to write these columns; if they
-- don't exist yet (this migration not run), the insert fails and
-- the code automatically retries with the old baked-flat path. So
-- sharing keeps working before AND after you run this — it just
-- renders flat until the columns exist. Pots shared BEFORE the
-- migration keep their baked image (the new columns stay null,
-- and renderSavedPot falls back to the baked paint_data_url).
-- Re-share a pot after the migration to upgrade it to the live
-- recipe render.
-- ============================================================

alter table public_pots
    add column if not exists surface_texture_pack_id text,
    add column if not exists stickers                jsonb;

alter table battle_entries
    add column if not exists surface_texture_pack_id text,
    add column if not exists stickers                jsonb;

-- No indexes needed — these columns are only read back with the
-- row itself (never filtered/sorted on). jsonb stores compact;
-- a busy pot's sticker array is a few hundred bytes.
