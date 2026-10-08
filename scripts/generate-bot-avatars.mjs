#!/usr/bin/env node
/**
 * Bake the bloub avatar stills (see tools/bloub/README.md) into base64 SVG
 * data URLs for `BOT_AVATARS` in src/client.ts.
 *
 * Runs the vendored framework-free engine at build time — the shipped client
 * never carries it. Mirrors BloubBot.vue's SVG structure exactly: eyes are
 * holes punched through the body via a mask (they clip themselves at the
 * silhouette), the eye-hole backdrop is filled with the tile background (not
 * white), orbit halves render behind/front of the body, burst particles
 * respect dotsBehind.
 *
 * Usage: npx tsx scripts/generate-bot-avatars.mjs
 * Output: tools/bloub/avatars.gen.json (+ preview HTML) and the array
 * literal on stdout, for pasting into src/client.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BotEngine } from '../tools/bloub/src/engine.ts'
import { mixHex } from '../tools/bloub/src/skins.ts'
import { RAYON } from '../tools/bloub/src/repere.ts'
import { NOTIF_BLUE } from '../tools/bloub/src/decor.ts'

const TILE = 128 // rendered tile, matches the previous BOT_AVATARS viewBox
const HALF = TILE / 2
const PAPER = '#f9f9f9' // bloub's default page paper; eye holes read against it

/**
 * Variant table: one bloub still per built-in avatar slot. `state` is one of
 * the 14 measured states; `ink` is the body colour from the bloub palette.
 * `world` is the engine half-extent that must fit the tile: the compact states
 * only reach ~1.15 radii, the arc states climb to 1.58 (rings/swoosh) —
 * REPERE.DEMI_VIEWBOX. The scale is derived, not hand-tuned.
 */
const VARIANTS = [
  { state: 'idle', ink: '#0a0a0c' }, // the signature: black blob on paper
  { state: 'thinking', ink: '#3b93f0' },
  { state: 'wink', ink: '#e152b0' },
  { state: 'play', ink: '#3ecf8e' },
  { state: 'notify', ink: '#8b5cf6' },
  { state: 'wide', ink: '#f08a24' },
  { state: 'orbit', ink: '#2fbfa0', world: 158 },
  { state: 'egg', ink: '#f0b429' },
]

const n2 = (v) => Math.round(v * 100) / 100
const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** First t where both eyes are fully open (gaze drift lives, blink avoided). */
function settleT(engine) {
  let pick = 1.2 // eyeless states (sleep/egg): any settled t works
  let widest = -1
  for (let t = 0.1; t <= 3; t += 0.05) {
    const frame = engine.sample(t)
    if (frame.eyes.length === 0) return pick
    const open = frame.eyes.reduce((acc, eye) => {
      const m = /matrix\(([-\d. e,]+)\)/.exec(eye.matrix)
      const vals = m ? m[1].trim().split(/[\s,]+/).map(Number) : [1, 0, 0, 1, 0, 0]
      return Math.min(acc, Math.hypot(vals[0], vals[1]))
    }, Infinity)
    if (open > widest) { widest = open; pick = t }
  }
  return pick
}

/** One tile: background + the bloub still, mirroring BloubBot.vue's layers. */
function renderVariant(variant, index) {
  const engine = new BotEngine(RAYON, variant.state, null, null)
  const frame = engine.sample(settleT(engine))
  const ink = variant.ink
  const bg = mixHex(PAPER, ink, 0.14)
  // Fit the state's world half-extent into the tile with a small margin;
  // the body (radius 100) then reads as ~80% of the tile on compact states.
  const world = variant.world ?? 115
  const scale = (HALF - 4) / world
  const uid = `bloub${index}`
  const VB = TILE / 2 / scale // engine half-viewBox inside the scaled group

  const defs = []
  defs.push(`<mask id="${uid}m" maskUnits="userSpaceOnUse" x="${-VB}" y="${-VB}" width="${VB * 2}" height="${VB * 2}">` +
    `<path d="${attr(frame.bodyPath)}" fill="#fff"/>` +
    frame.eyes.map((eye) =>
      `<path d="${attr(eye.d)}" transform="${attr(eye.matrix)}" opacity="${n2(eye.alpha)}" fill="#000"/>`).join('') +
    (frame.notch ? `<circle cx="${n2(frame.notch.x)}" cy="${n2(frame.notch.y)}" r="${n2(frame.notch.r)}" fill="#000"/>` : '') +
    `</mask>`)
  for (const arc of frame.arcs) {
    defs.push(`<linearGradient id="${uid}g${attr(arc.id)}" gradientUnits="userSpaceOnUse" ` +
      `x1="${n2(arc.grad.x1)}" y1="${n2(arc.grad.y1)}" x2="${n2(arc.grad.x2)}" y2="${n2(arc.grad.y2)}">` +
      arc.grad.stops.map((c, i) => `<stop offset="${i / (arc.grad.stops.length - 1)}" stop-color="${c}"/>`).join('') +
      `</linearGradient>`)
  }

  const dotAttrs = (dot) => {
    const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(PAPER, ink, dot.depth))
    const common = `fill="${fill}" opacity="${n2(dot.opacity)}"`
    return dot.d
      ? `<path ${common} d="${attr(dot.d)}" transform="translate(${n2(dot.x)} ${n2(dot.y)}) rotate(${n2(dot.rot ?? 0)}) scale(${RAYON})"/>`
      : `<circle ${common} cx="${n2(dot.x)}" cy="${n2(dot.y)}" r="${n2(dot.r)}"/>`
  }
  const arcPaths = (side) => frame.arcs.map((arc) =>
    `<path d="${attr(arc[side])}" stroke="url(#${uid}g${attr(arc.id)})" stroke-width="${n2(arc.width)}" opacity="${n2(arc.opacity)}"/>`).join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-HALF} ${-HALF} ${TILE} ${TILE}" fill="none" shape-rendering="auto" aria-hidden="true">` +
    `<defs>${defs.join('')}</defs>` +
    `<rect x="${-HALF}" y="${-HALF}" width="${TILE}" height="${TILE}" rx="0" ry="0" fill="${bg}"/>` +
    `<g transform="scale(${n2(scale)})">` +
    (frame.arcs.length ? `<g fill="none" stroke-linecap="round">${arcPaths('back')}</g>` : '') +
    (frame.dotsBehind ? `<g>${frame.dots.map(dotAttrs).join('')}</g>` : '') +
    `<g opacity="${n2(frame.bodyAlpha)}">` +
    `<path d="${attr(frame.bodyPath)}" fill="${PAPER}"/>` +
    `<g mask="url(#${uid}m)"><rect x="${-VB}" y="${-VB}" width="${VB * 2}" height="${VB * 2}" fill="${ink}"/></g>` +
    `</g>` +
    (!frame.dotsBehind ? `<g>${frame.dots.map(dotAttrs).join('')}</g>` : '') +
    (frame.notif ? `<circle cx="${n2(frame.notif.x)}" cy="${n2(frame.notif.y)}" r="${n2(frame.notif.r)}" fill="${NOTIF_BLUE}"/>` : '') +
    (frame.arcs.length ? `<g fill="none" stroke-linecap="round">${arcPaths('front')}</g>` : '') +
    `</g></svg>`
  return { variant, svg }
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const results = VARIANTS.map(renderVariant)
const avatars = results.map((r) => 'data:image/svg+xml;base64,' + Buffer.from(r.svg, 'utf8').toString('base64'))

const outDir = join(root, 'tools', 'bloub')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'avatars.gen.json'), JSON.stringify({
  source: 'https://github.com/jeremy-prt/bloub (MIT, Jérémy Perret)',
  generated: new Date().toISOString(),
  variants: results.map((r) => ({ state: r.variant.state, ink: r.variant.ink, world: r.variant.world ?? 115 })),
  avatars,
}, null, 1) + '\n')

writeFileSync(join(outDir, 'preview.html'),
  `<!doctype html><meta charset="utf8"><body style="display:flex;gap:18px;background:#1b1e26;padding:24px">` +
  avatars.map((a) => `<img src="${a}" width="128" height="128" style="border-radius:18px">`).join('') +
  `</body>`)

console.log('const BOT_AVATARS = [')
for (const a of avatars) console.log(`        '${a}',`)
console.log('      ]')
