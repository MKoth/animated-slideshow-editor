import { describe, expect, it } from 'vitest'
import {
  buildScenarioImageFiles,
  extensionFromMimeOrFilename,
  renderScenarioChalkHtml,
  scenarioImageFilename,
  slugFilenameForAssetKey,
} from '../../engine/scenarioChalkRender'

const MD = [
  '## Step 1 — Who you are',
  '',
  '**Narrator:** Ser is for who you are.',
  '',
  '![Young doctor smiling](asset:young-doctor-smiling)',
  '',
  '> Brief: Warm portrait — stays in markdown only.',
  '',
  '| Spanish | English |',
  '| --- | --- |',
  '| Soy doctora | I am a doctor |',
  '',
  'You say **soy** tomorrow.',
  '',
  '## Step 2 — Where you are',
  '',
  '![Empty classroom chairs](asset:empty-classroom-chairs)',
  '',
  '<!-- reuse: Classroom Chairs -->',
  '',
  'Estamos en clase.',
  '',
  '## Step 3 — Bare',
  '',
].join('\n')

describe('scenarioChalkRender pure seam (issue #464)', () => {
  it('renders one section per Step in markdown order with canonical block order', () => {
    const html = renderScenarioChalkHtml(MD, {
      imageFiles: {
        'young-doctor-smiling': 'young-doctor-smiling.png',
        'empty-classroom-chairs': 'empty-classroom-chairs.png',
      },
    })
    const sections = [...html.matchAll(/<section[^>]*data-step="(\d+)"[^>]*>/g)].map((m) => m[1])
    expect(sections).toEqual(['1', '2', '3'])
    // Step 1 block order: narrator before visuals before table before text.
    const s1 = html.split('data-step="1"')[1]!.split('data-step="2"')[0]!
    expect(s1.indexOf('class="narrator"')).toBeLessThan(s1.indexOf('<figure'))
    expect(s1.indexOf('<figure')).toBeLessThan(s1.indexOf('<table'))
    expect(s1.indexOf('<table')).toBeLessThan(s1.indexOf('class="chalk-text"'))
    // Bare step never errors and still renders its heading.
    expect(html).toContain('Bare')
  })

  it('skips missing optional blocks without erroring on sparse steps', () => {
    const sparse = ['## Step 1 — Only text', '', 'Just words.', ''].join('\n')
    expect(() => renderScenarioChalkHtml(sparse, { imageFiles: {} })).not.toThrow()
    const html = renderScenarioChalkHtml(sparse, { imageFiles: {} })
    expect(html).toContain('Only text')
    expect(html).toContain('Just words.')
    expect(html).not.toContain('<figure')
    expect(html).not.toContain('<table')
  })

  it('captions figures with the chalk label and ignores remove/wipe markers', () => {
    const md = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '![Green tree](asset:green-tree)',
      '',
      '> Brief: A tree.',
      '',
      '> Label: El árbol ES verde',
      '',
      '[wipe]',
      '',
      '## Step 2 — Two',
      '',
      '[remove: green-tree]',
      '',
      'Done.',
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(md, { imageFiles: { 'green-tree': 'green-tree.png' } })
    expect(html).toContain('<figcaption>El árbol ES verde</figcaption>')
    expect(html).not.toContain('[wipe]')
    expect(html).not.toContain('[remove:')
    expect(html).not.toContain('Brief:')
  })

  it('maps images to the assets folder by slug filename with free-text alt preserved', () => {
    const html = renderScenarioChalkHtml(MD, {
      imageFiles: {
        'young-doctor-smiling': 'young-doctor-smiling.png',
        'empty-classroom-chairs': 'empty-classroom-chairs.png',
      },
    })
    expect(html).toContain('src="assets/young-doctor-smiling.png"')
    expect(html).toContain('alt="Young doctor smiling"')
    expect(html).toContain('src="assets/empty-classroom-chairs.png"')
    expect(html).toContain('alt="Empty classroom chairs"')
  })

  it('resolveAssetUrl rewrites image sources (preview embeds data URIs)', () => {
    const html = renderScenarioChalkHtml(MD, {
      imageFiles: {
        'young-doctor-smiling': 'young-doctor-smiling.png',
        'empty-classroom-chairs': 'empty-classroom-chairs.png',
      },
      resolveAssetUrl: (file) => `data:image/png;base64,BYTES-FOR-${file}`,
    })
    expect(html).toContain('src="data:image/png;base64,BYTES-FOR-young-doctor-smiling.png"')
    expect(html).toContain('src="data:image/png;base64,BYTES-FOR-empty-classroom-chairs.png"')
    expect(html).not.toContain('src="assets/')
    expect(html).toContain('alt="Young doctor smiling"')
  })

  it('keeps briefs and reuse names out of the page', () => {
    const html = renderScenarioChalkHtml(MD, {
      imageFiles: {
        'young-doctor-smiling': 'young-doctor-smiling.png',
        'empty-classroom-chairs': 'empty-classroom-chairs.png',
      },
    })
    expect(html).not.toContain('Warm portrait')
    expect(html).not.toContain('Brief:')
    expect(html).not.toContain('Classroom Chairs')
    expect(html).not.toContain('reuse')
  })

  it('applies the single mandatory chalk theme with no picker or variant', () => {
    const html = renderScenarioChalkHtml(MD, {
      imageFiles: { 'young-doctor-smiling': 'young-doctor-smiling.png' },
    })
    // Fixed tokens on dark board.
    expect(html).toContain('--board: #20302A')
    expect(html).toContain('--chalk: #F4F1E8')
    expect(html).toContain('--chalk-dim: #C9CFC4')
    expect(html).toContain('#F2D98C')
    // Sketch headings + handwritten body stacks.
    expect(html).toContain('Cabin Sketch')
    expect(html).toContain('Kalam')
    // Grain + wobble borders, offline fonts, print fallback.
    expect(html).toContain('feTurbulence')
    expect(html).toContain('255px 15px 225px 15px')
    expect(html).toContain('assets/fonts/')
    expect(html).toContain('@media print')
  })

  it('emits a static page with no scripts, no playback, and no runtime fetches', () => {
    const html = renderScenarioChalkHtml(MD, {
      imageFiles: {
        'young-doctor-smiling': 'young-doctor-smiling.png',
        'empty-classroom-chairs': 'empty-classroom-chairs.png',
      },
    })
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html).not.toContain('fetch(')
    expect(html).not.toContain('http://')
    expect(html).not.toContain('https://')
    // Relative asset refs only.
    const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!)
    expect(srcs.length).toBeGreaterThan(0)
    for (const src of srcs) {
      expect(src.startsWith('assets/')).toBe(true)
    }
  })

  it('is deterministic for identical markdown plus bytes', () => {
    const files = { 'young-doctor-smiling': 'young-doctor-smiling.png' }
    expect(renderScenarioChalkHtml(MD, { imageFiles: files })).toBe(
      renderScenarioChalkHtml(MD, { imageFiles: files }),
    )
  })

  it('escapes markdown content so sparse steps never break the page', () => {
    const evil = [
      '## Step 1 — <b>Bold</b> & "quotes"',
      '',
      '**Narrator:** Say <hi> & bye.',
      '',
      'Text with <img src=x onerror=alert(1)> payload.',
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(evil, { imageFiles: {} })
    expect(html).not.toContain('<b>Bold</b>')
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt;')
    expect(html).not.toContain('<img src=x')
  })

  it('slug helpers mirror the normalized key with safe filenames and collision suffixes', () => {
    expect(slugFilenameForAssetKey('Young Doctor Smiling')).toBe('young-doctor-smiling')
    expect(slugFilenameForAssetKey('  Empty\tclassroom\nchairs  ')).toBe('empty-classroom-chairs')
    expect(extensionFromMimeOrFilename('image/png')).toBe('png')
    expect(extensionFromMimeOrFilename('image/jpeg', 'photo.JPG')).toBe('jpg')
    expect(extensionFromMimeOrFilename(undefined, 'scan.webp')).toBe('webp')
    expect(extensionFromMimeOrFilename(undefined, undefined)).toBe('png')
    expect(scenarioImageFilename('young-doctor-smiling', 'image/png')).toBe(
      'young-doctor-smiling.png',
    )
    const files = buildScenarioImageFiles(['cat', 'cat'], (key) => ({
      mime: 'image/png',
      filenameHint: `${key}.png`,
    }))
    // Duplicate keys collapse (checklist dedupes); distinct keys slugging
    // to the same filename gain numeric suffixes.
    expect(files['cat']).toBe('cat.png')
    const colliding = buildScenarioImageFiles(['a-b', 'a_b'], () => ({ mime: 'image/png' }))
    expect(colliding['a-b']).toBe('a-b.png')
    expect(colliding['a_b']).toBe('a-b-2.png')
  })
})
