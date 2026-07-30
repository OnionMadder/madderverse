-- ============================================================
-- v1.2 "glaze recipe" columns — SQL migration
-- ============================================================
-- Run this once in the Supabase SQL editor. Adds two columns to
-- BOTH public_pots and battle_entries so a shared pot carries its
-- GLAZE as data instead of losing it:
--
--   dips     — the dip-glaze coats (jsonb). Either a one-tap
--              gradient pour, [{"preset":"sunset"}], or a freehand
--              coat, [{"color":"#f4f6ea","cover":0.46,
--              "drips":1,"seed":161666836}]. Coats stack, so this
--              is an ordered array, not a single value.
--   overlay  — the full-body WRAP, as the pack id whose pattern is
--              applied ('core' / 'candy' / 'moons' / ...), or null.
--
-- WHY: this was a real bug, not just a fidelity upgrade. Before
-- this migration NEITHER share tier carried the glaze at all —
-- publicPotCommonBody sent the profile, clay and fired flags, the
-- v1.1 recipe tier added texture + stickers, and the baked tier
-- flattened only texture + paint + stickers. Dips and the wrap
-- were in none of them. A pot shared to EVERYONE, or entered in a
-- battle, therefore arrived with its glaze stripped off and
-- rendered as bare clay. Local pots were unaffected, because the
-- MINE tab renders straight from localStorage — which is exactly
-- why it looked like a gallery-rendering problem.
--
-- FORWARD/BACKWARD COMPAT: same "recipe first, bake on fallback"
-- upload as v1.1. game.js now ALSO bakes the dip + wrap into
-- paint_data_url on the fallback path, so the glaze is visible
-- whether or not you have run this migration. Running it upgrades
-- shared pots from "glaze baked flat into the image" to "glaze
-- re-rendered through the live pipeline", which means it is lit
-- with the pot instead of sitting above the lighting, and it
-- stays correct if the render ever changes.
--
-- Pots shared BEFORE this migration keep their baked image; the
-- new columns stay null and normalizePublicRow defaults dips to []
-- and overlay to null, so nothing double-draws.
--
-- Safe to re-run: every statement is IF NOT EXISTS.
-- ============================================================

alter table public.public_pots
    add column if not exists dips    jsonb,
    add column if not exists overlay text;

alter table public.battle_entries
    add column if not exists dips    jsonb,
    add column if not exists overlay text;

-- Row Level Security: these are plain data columns on tables that
-- already have their policies set by SUPABASE_POTS_V11.sql, so no
-- policy changes are needed. Adding a column does not widen access.

-- ---- verify ------------------------------------------------
-- Expect four rows: dips/overlay on each of the two tables.
--
-- select table_name, column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name in ('public_pots', 'battle_entries')
--    and column_name in ('dips', 'overlay')
--  order by table_name, column_name;
