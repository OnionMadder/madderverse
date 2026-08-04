# Slip Studio — commissions

A spec for the merchant system, with the merchant taken out: people who ask for
pots, and tell you where the pot ended up. No currency, no deadlines, no grading.

Written against **web v224**. Nothing here is built yet.

---

## Why

The hardest moment in a sandbox is the fifth session. The player opens the app,
sees the shape picker, and has no idea what to make. That is what actually ends a
creative toy — not a lack of rewards, but **the blank wheel**.

Other pottery games solve it with merchants and orders, and the machinery they
bolt on is genuinely unpleasant: currency that gates content you already bought,
deadlines that turn making into an obligation, selling that *consumes* the thing
you made, star ratings that replace your judgment with a rubric.

None of that machinery is load-bearing. What a commission actually provides is:

- **A reason to make *this* pot** rather than facing an empty studio.
- **A constraint**, and constraint is generative. "A tall bottle, mostly blue,
  with something growing on it" is far easier to start than "anything."
- **A sense the work goes somewhere** and has a life after you make it.

You can have all three without a single coin.

---

## What the player does

1. Opens the requests board — a few open asks, in the voice of whoever's asking.

   > **The tea house on the hill**
   > *"We've been serving out of mismatched cups for a year and I've stopped
   > pretending it's charming. Four of anything, as long as they're four."*

   > **Ines, who is seven**
   > *"my bean plant is too big for its old pot. it needs a BIG one. it can be
   > any colour except brown, brown is boring."*

2. Whenever they like — now, next week, never — they tap **Give a pot** and pick
   any piece from their gallery.

3. The recipient writes back. Not a score: a small note about what the pot is
   *for* now.

   > *"They came out unmatched, which I did not ask for and now cannot imagine
   > the place without. The tall one is mine. Nobody else is allowed it."*

4. **The pot stays in the gallery**, and gains a line beneath its title:
   *"This one lives in the tea house on the hill."*

5. The note is kept, in a small collection of letters.

---

## The design decision that makes this work

**The pot is never checked against the request.**

No matching, no validation, no rejection. If someone hands the tea house a single
tiny pink cup instead of four of anything, the tea house is delighted. The
request exists to give the player an idea, not to grade them against it.

This one rule does an enormous amount of work:

- It removes every judgment surface from the feature. There is no wrong pot.
- It sidesteps an intractable technical problem. "Is this bottle *tall*? Is it
  *mostly blue*?" is fragile, subjective, and would produce a system that tells a
  child their pot doesn't count.
- It keeps the request a *prompt*, which is what makes it generative. A brief you
  can answer sideways is a better brief.

The recipient's reply is written to work with any pot — it responds to the *act*,
and to the fact that the pot is specific and unexpected, rather than to the pot's
properties. That's also just better writing.

---

## Non-goals — the rules that keep this benevolent

- **No timer, no expiry, no "you missed it."** Requests wait indefinitely.
- **No currency and no unlocks.** Nothing in the app is gated behind commissions.
- **The pot is never consumed.** You gave something and you kept it. This is the
  emotional core of the whole feature.
- **No rating, ever.** The recipient never scores the work, never compares it to
  what they asked for, never expresses disappointment.
- **No counter of unfinished requests**, no badge on the button, no "2 people are
  waiting." Nobody is waiting. That framing is the thing we're avoiding.
- **No relationships to maintain.** The cast has no affinity meters, no
  friendship levels, nothing that decays if you don't visit. They're people who
  occasionally ask for things, not a resource to tend.
- **Ignorable forever**, with the board no more insistent than the gallery button.

---

## Data model

Requests and letters are curated content; only the player's answers are state.

```js
// Curated, in main.js — content, not state.
const REQUESTS = {
  teahouse: {
    from: "The tea house on the hill",
    ask:  "We've been serving out of mismatched cups…",
    reply: "They came out unmatched, which I did not ask for…",
    note: "This one lives in the tea house on the hill.",
  },
  // …
};
```

```js
const COMMISSIONS_KEY = "slip-commissions";   // alongside "slip-collections"
// { given: { teahouse: { potId: 17, at: 1785312000000 } }, seen: ["teahouse", …] }
```

The pot's side of the link goes on its IndexedDB entry as `commissionId`, exactly
mirroring how `collectionId` already works: the gallery card reads it to show the
note, and a dangling id (pot deleted, or a request retired) must degrade quietly
— `loadCollections()` already establishes that pattern and its filtering.

No new object store and no DB version bump: `commissionId` is one more field on
an existing entry, and everything else is localStorage.

---

## Which requests are open

Three or four visible at a time, drawn from the pool. A given request retires and
another takes its place. Selection can simply be "the next unseen one" — this
does not need to be clever, and **must not be time-gated**. No daily rotation, no
"come back tomorrow for new requests." That's the exact mechanic we're refusing.

If the pool empties, the board says so warmly and stays open. Running out of
written content should feel like finishing a good book, not like hitting a wall.

---

## The real cost of this feature is writing

**This is roughly 20% code and 80% Onion's voice**, and the writing is the part
that makes it work. The code is a modal, a list, a picker, and one field on a
save entry. The charm is entirely in the asks and the replies.

Budget something like **30–40 requests** to carry a long time. Each needs an ask
(2–3 sentences) and a reply (2–3 sentences) — so on the order of 200 short
paragraphs, in distinct voices.

Some notes on what makes them land, based on the two examples above:

- **Specific beats grand.** A tea house tired of mismatched cups is better than a
  museum seeking a masterpiece. Small stakes are warmer and easier to satisfy.
- **Let the requester be wrong about what they want**, and delighted anyway. That
  is the emotional payload of the no-validation rule, made explicit in the text.
- **Vary who's asking** — a child, someone elderly, a shop, someone who wants a
  pot for a reason they don't fully explain.
- **Never mention quality.** Not "beautiful", not "well made". What the pot is
  *for* is the reward; how good it is was never the question.

This is the same instinct as Florigami's flavour text, and it's the thing the app
currently has none of. Slip Studio is beautiful and completely silent about
itself. A little writing would go a long way.

---

## Integration points

| What | Where | Change |
|------|-------|--------|
| `COLLECTIONS_KEY` / `loadCollections` / `assignToCollection` | ~8145–8210 | The exact model to copy: localStorage index + an id on the IndexedDB entry + defensive filtering of dangling ids. |
| Gallery card render | ~8680 | Reads `collectionId` for the shelf name already; add the commission note the same way. |
| `savePot` / `corePieceFields` | save section | `commissionId` is on the *entry*, not the piece snapshot — it describes where the object went, not how it was made. Keep it out of `corePieceFields`. |
| Gallery picker | gallery modal | "Give a pot" reuses the existing gallery grid as a chooser. |
| `trapFocus` / `releaseFocus` | v192 | The board is a dialog and raises the gallery picker on top of itself — the focus stack handles this; Escape closes. |
| `showToast`, `haptic` | ~8831 | The reply arrives as a modal, not a toast — it's the payoff and deserves the room. |
| `window.__slip` | ~1937 | `openRequests`, `givePot(reqId, potId)`, `commissions()`. |
| `index.html` `?v=` | — | Bump. |

---

## Build phases

**Phase 1 — the board.** Requests list, give a pot from the gallery, the reply
modal, the note on the gallery card, persistence. Ship with 10–12 written
requests; that's enough to prove whether it lands.

**Phase 2 — the letters.** A kept collection of every reply, readable any time.
Cheap once phase 1 exists, and it's what makes the feature accumulate rather than
evaporate.

**Phase 3 — more writing.** Grow to 30–40. Pure content, no code.

**Phase 4 — if it earns it.** Requests that ask for a *set* (the tea house wanting
four) and accept several pots. Modest code, and it leans on the pot+lid set
handling that already exists.

---

## Open questions for Onion

1. **Do you want to write this?** It genuinely lives or dies on the voice, and it
   is the one feature of the three that I can't build most of. If the writing
   isn't appealing, the tile wall and the firing types are better uses of the
   time — both are nearly all code.
2. **A recurring cast, or one-off strangers?** A small cast who come back is far
   more charming. The risk is that it implies relationships, and relationships
   imply maintenance, which is the door engagement mechanics walk through. I
   think a cast with *no* stats, no affinity, and no decay is safe — but it's
   worth being deliberate about it.
3. **Should there be any requests aimed at young players specifically** — simpler
   asks, simpler language — given the Teacher Approved audience?
4. **Where does the board live?** Beside the gallery is the cheap answer. A
   noticeboard in the studio is the charming one.
