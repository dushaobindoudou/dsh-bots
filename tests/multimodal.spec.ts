/**
 * Multimodal guards: image attachments from the composer all the way to the
 * gateway's model-visible image pipeline.
 *
 * The host half is pinned by source (it needs a live gateway to exercise for
 * real); the projection half is unit-tested against `trimEntry` directly.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { trimEntry } from '../src/gateway.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
const CLIENT = readFileSync(join(ROOT, 'src', 'client.ts'), 'utf8')
const SHARED = readFileSync(join(ROOT, 'src', 'shared.ts'), 'utf8')
const GATEWAY = readFileSync(join(ROOT, 'src', 'gateway.ts'), 'utf8')

describe('multimodal projection', () => {
  it('keeps user-attachment entries on their own display value', () => {
    expect(SHARED).toContain("'attachment'")
    expect(GATEWAY).toMatch(/kind === 'user-attachment'\) return 'attachment'/)
    const en = trimEntry({
      kind: 'user-attachment', id: 't9u',
      file_path: '/Users/x/.sdk-bots/dsh-bots-uploads/a.png',
      file_name: '截图.png', width: 1280, height: 800, byteSize: 12345,
    })
    expect(en.display).toBe('attachment')
    expect(en.filePath).toBe('/Users/x/.sdk-bots/dsh-bots-uploads/a.png')
    expect(en.fileName).toBe('截图.png')
    expect(en.width).toBe(1280)
    expect(en.height).toBe(800)
    expect(en.byteSize).toBe(12345)
  })

  it('leaves plain entries without attachment fields', () => {
    const en = trimEntry({ kind: 'message', role: 'user', content: '你好' })
    expect(en.display).toBe('user')
    expect(en.filePath).toBeNull()
    expect(en.byteSize).toBeNull()
  })
})

describe('multimodal host send', () => {
  it('rides the gateway attachmentPaths channel, not a bespoke one', () => {
    // The engine already turns attachmentPaths into model-visible images
    // (splitAttachmentPathsByChannel → selectedImages) for direct AND group
    // turns — the host must reuse that channel, not invent a parallel one.
    expect(HOST).toMatch(/attachmentPaths, attachmentNames/)
  })

  it('materializes uploads inside the gateway data dir', () => {
    // readImage previews only resolve inside the gateway data root, so the
    // uploads have to live there for the transcript thumbnails to work.
    expect(HOST).toContain("join(effectiveDataDir(this.cfg.dataDir), 'dsh-bots-uploads')")
    expect(HOST).toContain('mkdirSync(dir, { recursive: true })')
  })

  it('enforces the same limits the engine applies (4 images, 8MB each)', () => {
    expect(HOST).toContain('MAX_IMAGES_PER_SEND = 4')
    expect(HOST).toMatch(/MAX_IMAGE_BYTES = 8 \* 1024 \* 1024/)
  })

  it('allowlists wire image types mapped to engine-recognized extensions', () => {
    expect(HOST).toMatch(/'image\/png': '\.png'/)
    expect(HOST).toMatch(/'image\/jpeg': '\.jpg'/)
    expect(HOST).toMatch(/'image\/webp': '\.webp'/)
    expect(HOST).toMatch(/unsupported image type/)
  })

  it('stays text-only compatible when no images are sent', () => {
    // Old callers send {agentId, prompt} and must keep working byte-identically.
    expect(HOST).toMatch(/prompt: String\(request\?\.prompt \?\? ''\)/)
    expect(HOST).toMatch(/attachmentPaths\.length > 0 \? \{ attachmentPaths, attachmentNames \} : \{\}/)
  })
})

describe('multimodal composer', () => {
  it('renders attachment entries as image bubbles via the readImage pipe', () => {
    expect(CLIENT).toMatch(/en\.display === 'attachment'/)
    expect(CLIENT).toMatch(/e\(MediaImage, \{ path: en\.filePath \}\)/)
  })

  it('offers a file picker behind the native paperclip button', () => {
    expect(CLIENT).toMatch(/accept: 'image\/png,image\/jpeg,image\/gif,image\/webp,image\/bmp'/)
    // Native InputBar draws the attach control with IconPaperclipOutline16 in
    // the LEFT tools group; the local glyph only stands in if it is missing.
    // Ico builds the ELEMENT — passing the raw export renders a function child
    // and the paperclip silently vanished.
    expect(CLIENT).toMatch(/Ico\('IconPaperclipOutline16', \{ size: 14 \}\) \?\? e\(PaperclipGlyph, null\)/)
    expect(CLIENT).not.toMatch(/nat\('Icon[A-Za-z0-9]+'/)
    expect(CLIENT).toContain('t(\'chat.attach\')')
  })

  it('accepts pasted screenshots from the clipboard', () => {
    expect(CLIENT).toMatch(/ev\.clipboardData\?\.files/)
  })

  it('sends images with the caption and clears them on success', () => {
    expect(CLIENT).toMatch(/images: pendingImages\.map\(\(im: any\) => \(\{ mediaType: im\.mediaType, dataBase64: im\.dataBase64, name: im\.name \}\)\)/)
    expect(CLIENT).toMatch(/setPendingImages\(\[\]\)/)
  })

  it('lets an image-only message send with an empty caption', () => {
    expect(CLIENT).toMatch(/text === '' && pendingImages\.length === 0\) \|\| sending\) return/)
    expect(CLIENT).toMatch(/disabled: sending \|\| \(input\.trim\(\) === '' && pendingImages\.length === 0\)/)
    expect(CLIENT).toMatch(/composing && input\.trim\(\) === '' && pendingImages\.length === 0/)
  })

  it('caps pending images at the host limit before any bytes move', () => {
    expect(CLIENT).toContain('SEND_IMAGE_LIMIT - pendingImages.length')
    expect(CLIENT).toContain("t('chat.attach.limit')")
  })

  it('discards pending images when switching conversations', () => {
    // Mount effect: the text draft persists, picked images do not.
    expect(CLIENT).toContain('switching conversations discards them')
    expect(CLIENT.match(/setPendingImages\(\[\]\)/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
