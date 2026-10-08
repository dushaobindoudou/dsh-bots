# bloub engine (vendored)

This directory vendors the rendering core of
[bloub](https://github.com/jeremy-prt/bloub) by Jérémy Perret (MIT licence,
`LICENSE` here): an SVG recreation of the x.ai bot avatar — one filled shape
morphing through 14 states, two white eyes, every number measured off the
reference video. Only `src/bot/` (the framework-free, clock-free engine:
`engine.sample(t)` is a pure function of time) is vendored, verbatim — no
edits, so upstream fixes apply cleanly.

The client does NOT import these files as modules: the dsh client entry is a
single self-contained `lib/client.js` (`package.json` `exports["./client"]`,
`tsconfig.client.json` includes only `src/client.ts`), so the engine must live
inside `src/client.ts` itself. `scripts/merge-bloub-engine.mjs` merges this
directory into one TypeScript block — dependency-ordered for value
initialisation (the original modules lean on ESM cycle tolerance), with
intra-package imports stripped, `export` keywords removed, and the two
legitimate private-name collisions (`ANGLES`, `pair`) renamed per file. The
merged block is pasted into `src/client.ts` above the avatar renderer
(`bloubFrameSvg` + `BloubAvatar`), which samples it live: bots without a
custom avatar morph at ~30 fps on one shared clock, gaze at the pointer, and
get their volume from a soft-light gloss over the measured flat pose.

Re-vendor + regenerate:

```bash
cp -R /path/to/bloub/src/bot/*.ts tools/bloub/src/
node scripts/merge-bloub-engine.mjs   # prints the merged block
```

then replace the merged block in `src/client.ts` (from the
`MERGED BLOUB ENGINE` banner down to `BloubAvatar`). The smoke check that the
merge stayed faithful lives in the avatars spec and the browser regression.
