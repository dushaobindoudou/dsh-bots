import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = readFileSync(join(ROOT, 'src', 'client.ts'), 'utf8')

describe('bloub live bot avatars', () => {
  // The fallback avatars are the bloub engine (the x.ai bot avatar recreated
  // as measured SVG, MIT, © Jérémy Perret) running INSIDE the client: bots
  // without a custom avatarDataUrl render live at ~30 fps, gaze at the
  // pointer, and get their volume from a soft-light gloss. The engine is
  // merged verbatim into client.ts because the client entry must stay one
  // self-contained file; tools/bloub is the vendored source of truth.
  it('carries the merged engine, generated from the vendored sources', () => {
    expect(CLIENT).toContain('MERGED BLOUB ENGINE')
    expect(CLIENT).toContain('scripts/merge-bloub-engine.mjs')
    expect(CLIENT).toMatch(/class BotEngine\b/)
    expect(existsSync(join(ROOT, 'tools', 'bloub', 'src', 'engine.ts'))).toBe(true)
    expect(existsSync(join(ROOT, 'tools', 'bloub', 'LICENSE'))).toBe(true)
    expect(existsSync(join(ROOT, 'scripts', 'merge-bloub-engine.mjs'))).toBe(true)
  })

  it('renders every frame with punched eyes and soft-light volume', () => {
    expect(CLIENT).toContain('function bloubFrameSvg')
    // eyes are holes in a mask over the body, not shapes painted on top
    expect(CLIENT).toMatch(/maskUnits="userSpaceOnUse"/)
    expect(CLIENT).toMatch(/<path d="\$\{attr\(frame\.bodyPath\)\}" fill="#fff"\/>/)
    // 3D gloss: radial body gradient + specular sheen + top-lit tile
    expect(CLIENT).toContain('radialGradient')
    expect(CLIENT).toContain('specular sheen')
    expect(CLIENT).toContain('mixHex(ink, \'#ffffff\', 0.26)')
    expect(CLIENT).toContain('mixHex(bg, \'#ffffff\', 0.35)')
  })

  it('animates on a shared clock, with reduced-motion and gaze fallbacks', () => {
    expect(CLIENT).toContain('(prefers-reduced-motion: reduce)')
    expect(CLIENT).toContain('requestAnimationFrame(bloubLoop)')
    // pointer gaze with the engine's own mixing; no pointer → drift restored
    expect(CLIENT).toContain('yaw: nx * 16, pitch: 10 - ny * 13, mix: 1, spin: 0, wander: 0')
    expect(CLIENT).toContain('engine.setLook(null, now)')
    // one clock stops itself when the last avatar unregisters
    expect(CLIENT).toContain('if (bloubTicks.size === 0) return')
  })

  it('routes bots to the live avatar, groups and custom avatars unchanged', () => {
    expect(CLIENT).toMatch(/e\(BloubAvatar, \{ seed: String\(a\.id \?\? a\.name \?\? 'bot'\), size \}\)/)
    expect(CLIENT).toMatch(/if \(typeof a\.avatarDataUrl === 'string' && a\.avatarDataUrl !== ''\)/)
    expect(CLIENT).not.toContain('BOT_AVATARS') // baked stills are gone
  })
})
