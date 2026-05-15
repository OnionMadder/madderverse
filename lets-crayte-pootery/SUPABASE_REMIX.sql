-- ============================================================
-- REMIX lineage — SQL migration
-- ============================================================
-- Run this once in the Supabase SQL editor. Adds two columns to
-- public_pots so when a remix is shared to EVERYONE, the public
-- copy carries the credit + we can count "X people remixed this"
-- on the original.
--
-- Forward-compat: lets-crayte-pootery/game.js writes lineage on
-- the LOCAL entry today (in localStorage) regardless of whether
-- these columns exist. The columns only matter when the remix
-- itself gets shared to public.
-- ============================================================

alter table public_pots
    add column if not exists remixed_from        uuid,
    add column if not exists remixed_from_author text;

-- Self-referential FK is technically appropriate but we leave it
-- unenforced -- if the source pot is deleted, we want the remix
-- to keep its credit (remixed_from_author is a frozen snapshot,
-- so the credit chip still reads correctly).

-- Index for the "how many people remixed this?" count + the
-- "show me the remixes of this pot" strip on pot-detail.
create index if not exists public_pots_remixed_from_idx
    on public_pots (remixed_from);
