# bloub engine (vendored)

This directory vendors the rendering core of
[bloub](https://github.com/jeremy-prt/bloub) by Jérémy Perret (MIT licence,
`LICENSE` here): an SVG recreation of the x.ai bot avatar — one filled shape
morphing through 14 states, two white eyes, every number measured off the
reference video. Only `src/bot/` (the framework-free, clock-free engine:
`engine.sample(t)` is a pure function of time) is vendored, verbatim except
for nothing — no edits, so upstream fixes apply cleanly.

dsh-bots does NOT ship this code: `package.json` `files` excludes `tools/`,
and the client must stay a single self-contained `lib/client.js`. The engine
runs at build time only, in `scripts/generate-bot-avatars.mjs`, which samples
avatar stills and bakes them into `src/client.ts` (`BOT_AVATARS`) as base64
SVG data URLs.

Regenerate after changing the variant table (or after pulling a new upstream):

```bash
npx tsx scripts/generate-bot-avatars.mjs   # prints the new BOT_AVATARS literal
```

then paste the printed array into `src/client.ts`. The preview HTML written
next to the JSON can be screenshotted for a visual check.
