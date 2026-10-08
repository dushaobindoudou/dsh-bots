import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = readFileSync(join(ROOT, 'src', 'client.ts'), 'utf8')

/** Extract the baked BOT_AVATARS data URLs from the client source. */
function bakedAvatars(): string[] {
  const block = /const BOT_AVATARS = \[\n(.*?)\n      \]/s.exec(CLIENT)
  expect(block, 'BOT_AVATARS array present in src/client.ts').toBeTruthy()
  return [...block![1].matchAll(/'(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)'/g)].map((m) => m[1])
}

describe('bloub bot avatars', () => {
  // The fallback avatars are stills of the bloub engine (the x.ai bot avatar
  // recreated as measured SVG, MIT, © Jérémy Perret) — baked at build time by
  // scripts/generate-bot-avatars.mjs from the vendored tools/bloub engine, so
  // the shipped client carries only data URLs and no engine code.
  it('bakes one still per slot, offline data URLs only', () => {
    const avatars = bakedAvatars()
    expect(avatars).toHaveLength(8)
    for (const url of avatars) expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true)
  })

  it('each still is a bloub render: masked body with punched eyes, tinted tile', () => {
    for (const url of bakedAvatars()) {
      const svg = Buffer.from(url.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8')
      // generator uid prefix, eye-hole mask, tile background and viewBox
      expect(svg).toContain('bloub')
      expect(svg).toContain('<mask')
      expect(svg).toContain('viewBox="-64 -64 128 128"')
      // the eye backdrop is filled with the page paper, not white
      expect(svg).toContain('fill="#f9f9f9"')
    }
  })

  it('keeps the vendored engine out of the shipped client bundle', () => {
    // client.ts must not import the engine — only the baked literals live there
    expect(CLIENT).not.toMatch(/from ['"].*bloub/)
    expect(CLIENT).toContain('scripts/generate-bot-avatars.mjs')
    expect(existsSync(join(ROOT, 'tools', 'bloub', 'src', 'engine.ts'))).toBe(true)
    expect(existsSync(join(ROOT, 'tools', 'bloub', 'LICENSE'))).toBe(true)
  })
})
