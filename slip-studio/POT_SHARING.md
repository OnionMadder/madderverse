# Slip Studio — pot sharing (send a pot to a friend)

Serverless creation-sharing: a pot travels as a small file through whatever
channel the family already uses. No accounts, no server, no gallery of
strangers — the parent's own share sheet is the network.

Written against **web v243**. Built same day (v244).

---

## Why a file, not a picture or a server

The research (see the competitive teardown of 2026-08-26) ranked the options:

- **Spore's data-inside-the-photo** is the most charming, but any messaging
  app that recompresses images destroys the payload — WhatsApp and Messenger
  do, and "my pot didn't arrive" is the worst possible failure for a child.
- **A server gallery** (Dreams, Mario Maker) conflicts directly with the
  Teacher Approved / no-data-collected posture — Dreams locks child accounts
  out of UGC entirely. The moment strangers' content flows in, the kids'
  rating is at risk. Refused.
- **A data file** (Townscaper codes, Wobbledogs dog codes, ACNL QR cards)
  survives every channel that carries attachments unmodified, carries no
  identity, and works fully offline. That's the one.

So: a `.slippot.json` file. Sent with the Web Share sheet (the same
`shareOrDownloadBlob` path the photo export uses), received through a file
picker. Nothing is collected, nothing goes through us, and the Data Safety
declaration is untouched.

## What the player does

1. Gallery → **Share** → "Send a pot" → pick a piece (sets travel whole).
2. The share sheet opens; the family sends the file however they like.
   (No share targets → it downloads, to attach by hand.)
3. The friend: Gallery → **Share** → "Open a pot" → picks the file.
4. The pot lands on their shelf with the line *"This one came from a
   friend."* — loadable, re-fireable, kiln-loadable, giveable like any
   other pot. Their copy is theirs; yours never leaves.

## Trust boundary — the part that must stay strict

An imported file is **untrusted input**. The importer:

- accepts only `{app:"slip-studio", kind:"pot-gift", v:1, pieces:[…]}`,
  1–2 pieces, file capped at 8 MB;
- copies **only whitelisted fields** through per-field validators
  (`SHARE_FIELDS`) — enum fields are checked against their tables
  (GLAZES/FIRINGS/RIM_STYLES/FINISHES), numbers clamped, canvas layers must
  match `data:image/png;base64,…`, placement/dip strings are length-capped
  and refuse `:` and `..` (no protocol or path tricks in motif ids);
- mints fresh `id`/`ts`/`setId` and sets `gifted: true` itself — nothing
  identity-shaped is read from the file, and nothing identity-shaped is
  ever written into one (export runs through the same whitelist, so
  `commissionId`, `studyId`, collection membership and timestamps stay home).

## Non-goals

- No sender name, message field, or any PII in the file — the channel
  (a text from grandma) already carries the who.
- No public gallery, no browse, no codes typed into the app.
- No import of anything but pots.

## Integration points

`shareOrDownloadBlob` grows a mime parameter · Share modal + picker follow
the confirm-modal / kiln-pick patterns, on the focus-trap stack with Escape ·
gallery card reads `gifted` next to where it reads `commissionId` · dev
handle: `exportPotFile`, `importPotData`, `openShareModal`.
