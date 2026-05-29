# MEGA pack — custom PNG stamps

Drop PNG files in this folder, register them in `game.js` →
`MEGA_STAMP_FILES`, and they show up as stamps in the **MEGA**
tab of the decorate palette.

## Workflow

1. Save your PNG here. Transparent background recommended;
   the image is rendered into a roughly `2r × 2r` square
   centered on the cursor, aspect ratio preserved.

2. Open `pootery/game.js`, find the
   `MEGA_STAMP_FILES` array (search for "MEGA PACK — Day 5
   chunk D"), and add a line:

   ```js
   const MEGA_STAMP_FILES = [
       { id: "shrek",     file: "shrek.png" },
       { id: "doge",      file: "doge.png" },
       { id: "rare-pepe", file: "rare-pepe.png" }
   ];
   ```

   `id` is the internal pattern id (used by the palette + by
   gallery entries that recorded a stamp of this name).
   Keep ids unique and stable — if you rename one later,
   previously-saved pots that stamped it will skip rendering
   that stamp.

3. Commit + push. The MEGA tab appears on the next load with
   each registered PNG as a clickable stamp.

## Tips

- Stamps are drawn AS-IS — the glaze color picker is ignored
  for PNGs (the image keeps its own pixels). If you want a
  multi-color variant, save it as a separate PNG.

- The "MEGA" tab stays hidden until at least one stamp is
  registered, so an empty manifest is fine.

- If a file goes missing, the console warns
  `[CRAYte] mega stamp missing: <name>.png` and that stamp
  renders as a dashed pink placeholder ring until the file is
  added back.

- Reasonable PNG size: ~256×256 to 512×512. Larger files just
  bloat the page load with no visible benefit.
