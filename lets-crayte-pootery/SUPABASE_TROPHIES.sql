-- ============================================================
-- Pot Battle trophies — SQL migration
-- ============================================================
-- Run this once in the Supabase SQL editor. It adds two columns
-- to the `battles` table and an RLS policy that lets any client
-- resolve a battle exactly once (atomic via the `resolved_at IS
-- NULL` guard — first writer wins).
--
-- Trophies live entirely in `battles.placements` (JSONB). We
-- don't write per-entry trophy columns because that'd require
-- multi-row writes; placements lookup is fast enough since each
-- battle has <100 entries in practice.
--
-- The client (lets-crayte-pootery/game.js) is forward-compatible
-- with these columns missing — trophy features just don't kick
-- in until the migration runs.
-- ============================================================

alter table battles
    add column if not exists placements jsonb,
    add column if not exists resolved_at timestamptz;

-- Index for the "trophy shelf" query (battles where any of the
-- caller's entry_ids appear in placements).
create index if not exists battles_placements_first_idx
    on battles using gin ((placements -> 'first'));
create index if not exists battles_placements_second_idx
    on battles using gin ((placements -> 'second'));
create index if not exists battles_placements_honorable_idx
    on battles using gin ((placements -> 'honorable'));

-- ============================================================
-- RLS — let any client resolve an expired, unresolved battle.
-- The guard is the (resolved_at IS NULL AND expires_at < now())
-- filter on the row being updated. Once `resolved_at` is set,
-- the row is locked from further updates by this policy.
-- ============================================================

-- Anonymous and authenticated clients can both resolve; the
-- update is conceptually a one-shot cron job that the next
-- client to visit happens to run. Reset the policy if it
-- exists so this script is idempotent.
drop policy if exists "anyone can resolve expired unresolved battle"
    on battles;

create policy "anyone can resolve expired unresolved battle"
on battles
for update
to anon, authenticated
using (
    resolved_at is null
    and expires_at < now()
)
with check (
    resolved_at is not null
);

-- ============================================================
-- Done. After this lands, the next client to open a battles
-- tab and load an expired battle will compute + write its
-- placements. Subsequent loads will read .placements from the
-- battle row directly without recomputing.
-- ============================================================
