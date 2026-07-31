# Slip Studio — vc20 Major-update event metrics tracker

> Purpose: measure whether the Play Store event that started 2026-07-31
> actually moved installs. Baseline is small (~7 acquisitions per 28 days),
> so percent changes will look wild — track **absolute numbers**.

## Baseline — pre-event snapshot (2026-07-30, last 28 days)

Play Console → Grow users → Metrics by: Device → Last 28 days.

| Metric                        | Value    | Notes                                             |
|-------------------------------|----------|---------------------------------------------------|
| Device impressions            | **16.7K**| +>999% vs prior period (Teacher Approved surge)   |
| Device acquisitions           | **7**    | -30% vs prior — installs are the money metric     |
| Device first opens            | **4**    | 0% — a few installers don't open                  |
| Monthly active devices        | **3**    | 0% — tiny active user base                        |
| 7-day device retention        | n/a      | not enough data yet                               |
| Conversion rate (visits→acq.) | **5.29%**| already respectable; browser→buyer is working     |
| Explore acquisitions (90d)    | **+2**   | small but positive discovery                      |

### Context that matters for interpreting the after

- **Price:** $0.99 (dropped from $2.99 after Teacher Approved, kept low as review-flywheel primer)
- **Badge:** Google Play **Teacher Approved** (earned 2026-07-02, ~4 weeks old)
- **Live version:** web v216, Play **vc13** (v136) until vc20 uploads
- **Simultaneous promo:** just the Major-update event, nothing else running
- **Itch upload:** *decide before launch* — if the itch build gets refreshed it may pull off-Play traffic; either do it now or hold until after the measurement window

## Success thresholds — calibrated to actual scale, not vanity

The event is doing real work if:

- **Impressions** climb noticeably during the event days (currently ~600/day; a Major-update surface push should be visible in the sparkline)
- **Acquisitions** during the event window (14 days) **≥ 15 total** — that's 2× the current 28-day rate compressed into 14 days. A modest bar.
- **Conversion rate** stays ≥ 4% — a small dip is fine (broader reach brings more browsers); a big dip means the card is drawing wrong-audience clicks
- **Post-event first fortnight** acquisitions ≥ 5 — measures whether the bump lingers or was purely event-window

If **acquisitions during the event ≤ 7** (matching the 28-day baseline), the event didn't move the needle and we know: it needs a better hook, a video, or a different graphic.

## Check-in schedule

Play numbers lag ~24-48h. Don't check obsessively — read patterns, not days.

| When            | What to snapshot                              | What to look for                              |
|-----------------|-----------------------------------------------|-----------------------------------------------|
| **2026-08-02**  | 2-day event totals (first 48h)                | Impression bump visible in the sparkline?     |
| **2026-08-05**  | 5-day event totals                            | Acquisitions on track for ≥ 15 by day 14?     |
| **2026-08-08**  | 8-day event totals                            | Halfway — decide if event should extend       |
| **2026-08-14**  | Full 14-day event window (compare vs baseline)| Verdict on the event's effect                 |
| **2026-08-28**  | Post-event fortnight                          | Does the lift linger, or snap back to 0.25/d? |

## Snapshot template — fill in each check-in

Copy this block and paste under a dated heading. Use the same 28-day window
end date each time so you can compare like-for-like.

```
## 2026-08-XX (day N of event)

- Impressions:                            (baseline 16.7K over 28d)
- Acquisitions during event (cumulative): (target ≥ 15 by day 14)
- Acquisitions today (from sparkline):
- Conversion rate:                        (baseline 5.29%)
- Reviews earned since launch:            (Play Console → Ratings & reviews)
- Event card views (Play Console → Promotional content → Event → Analytics)
- Notes / anything surprising:
```

## Confounding variables — flag these if they change mid-window

The measurement isn't clean if any of these move during the event:

- **Price change** (e.g. raising back to $2.99 after reviews land)
- **New badge or featured placement** on Play
- **A separate marketing push** (Bluesky post that goes big, itch feature, press mention)
- **A competitor's promotion** in the same category
- **Server-side algorithm shifts** — Play sometimes rebalances discovery; if impressions crater across all sources it's Play, not you

If any of the above happens, note it in the snapshot and mark that
comparison window as "confounded, cannot cleanly attribute".

## Post-mortem — after 2026-08-28

When the full 28 days is in, add a final block:

```
## Verdict — did the event work?

- Absolute install lift during event (vs baseline):    +N
- Absolute install lift after event (14-day tail):     +N
- Impressions ceiling reached during event:            N per day peak
- Conversion rate during vs baseline:                  A% → B%
- Total reviews earned:                                +N
- Would repeat this event pattern? YES / NO / MODIFIED
- What would you change for the next Major update?
```

This last block is what makes the *next* event better. Keep the numbers,
so the third and fourth releases build on real data instead of guesses.
