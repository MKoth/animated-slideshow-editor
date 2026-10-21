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
    expect(s1.indexOf('<table')).toBeLessThan(s1.indexOf('chalk-text'))
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

  it('captions each figure with its own label directly beneath the image', () => {
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
    // Label content (no "Label:" marker word) sits inside its own figure,
    // right under the image it belongs to.
    expect(html).toContain(
      '<figure class="visual"><img src="assets/green-tree.png" alt="Green tree" loading="lazy"><figcaption class="accent-yellow">El árbol ES verde</figcaption></figure>',
    )
    expect(html).not.toContain('Label:')
    expect(html).toContain('alt="Green tree"')
    expect(html).not.toContain('[wipe]')
    expect(html).not.toContain('[remove:')
    expect(html).not.toContain('Brief:')
  })

  it('renders figures without a caption when the visual has no label', () => {
    const md = [
      '## Step 1 — One',
      '',
      '![Green tree](asset:green-tree)',
      '',
      '> Brief: A tree.',
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(md, { imageFiles: { 'green-tree': 'green-tree.png' } })
    expect(html).not.toContain('<figcaption')
    expect(html).toContain('alt="Green tree"')
  })

  it('respects document order instead of piling all images before all text', () => {
    const md = [
      '## Step 1 — Mixed',
      '',
      '![First](asset:first)',
      '',
      '> Brief: First brief.',
      '',
      'Text after first.',
      '',
      '![Second](asset:second)',
      '',
      '> Brief: Second brief.',
      '',
      '> Label: Second label',
      '',
      'Text after second.',
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(md, {
      imageFiles: { first: 'first.png', second: 'second.png' },
    })
    const firstFig = html.indexOf('alt="First"')
    const firstText = html.indexOf('Text after first.')
    const secondFig = html.indexOf('alt="Second"')
    const secondCaption = html.indexOf('<figcaption class="accent-blue">Second label</figcaption>')
    const secondText = html.indexOf('Text after second.')
    expect(firstFig).toBeGreaterThan(-1)
    expect(firstText).toBeGreaterThan(firstFig)
    expect(secondFig).toBeGreaterThan(firstText)
    // The label sits inside its own figure, directly after its image.
    expect(secondCaption).toBeGreaterThan(secondFig)
    expect(secondCaption).toBeLessThan(secondText)
    expect(secondText).toBeGreaterThan(secondFig)
  })

  it('renders narrator as a plain paragraph without the Narrator role marker', () => {
    const html = renderScenarioChalkHtml(MD, {
      imageFiles: {
        'young-doctor-smiling': 'young-doctor-smiling.png',
        'empty-classroom-chairs': 'empty-classroom-chairs.png',
      },
    })
    expect(html).toContain('<p class="narrator">Ser is for who you are.</p>')
    expect(html).not.toContain('>Narrator')
    expect(html).not.toContain('<span class="role">')
    expect(html).not.toContain('class="role"')
  })

  it('cycles step headings through the chalk accent palette deterministically', () => {
    const md = [
      '## Step 1 — One',
      '',
      'Text one.',
      '',
      '## Step 2 — Two',
      '',
      'Text two.',
      '',
      '## Step 3 — Three',
      '',
      'Text three.',
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(md, { imageFiles: {} })
    expect(html).toContain('<h2 class="accent-yellow">Step 1 — One</h2>')
    expect(html).toContain('<h2 class="accent-pink">Step 2 — Two</h2>')
    expect(html).toContain('<h2 class="accent-blue">Step 3 — Three</h2>')
  })

  it('highlights author-marked foreign words inside English text', () => {
    const html = renderScenarioChalkHtml(MD, {
      imageFiles: {
        'young-doctor-smiling': 'young-doctor-smiling.png',
        'empty-classroom-chairs': 'empty-classroom-chairs.png',
      },
    })
    // Bold-marked foreign words become colored highlights, never literals.
    expect(html).toContain('<strong class="foreign">soy</strong>')
    expect(html).not.toContain('**soy**')
    // Spanish column of a Spanish|English vocabulary table is highlighted.
    expect(html).toContain('<td><strong class="foreign">Soy doctora</strong></td>')
    expect(html).toContain('<td>I am a doctor</td>')
    expect(html).toContain('strong.foreign')
  })

  it('highlights the LLM foreign-word list in narrator sentences', () => {
    const md = [
      '## Step 1 — Oak',
      '',
      '**Narrator:** In Spanish you call it árbol de roble, duradero y sólido.',
      '',
    ].join('\n')
    const foreignWords = ['árbol', 'de roble', 'duradero', 'y', 'sólido', 'roble']
    const html = renderScenarioChalkHtml(md, { imageFiles: {}, foreignWords })
    // Longest match wins: "de roble" highlights as one phrase, not "de" + "roble".
    expect(html).toContain('<strong class="foreign">árbol</strong>')
    expect(html).toContain('<strong class="foreign">de roble</strong>')
    expect(html).not.toContain('<strong class="foreign">de</strong>')
    expect(html).not.toContain('<strong class="foreign">roble</strong>')
    expect(html).toContain('<strong class="foreign">duradero</strong>')
    expect(html).toContain('<strong class="foreign">y</strong>')
    expect(html).toContain('<strong class="foreign">sólido</strong>')
    // Base-language words stay plain.
    expect(html).toContain('In Spanish you call it ')
    expect(html).not.toContain('<strong class="foreign">Spanish</strong>')
    expect(html).not.toContain('<strong class="foreign">call</strong>')
  })

  it('matches the LLM list case-insensitively on whole words only', () => {
    const md = [
      '## Step 1 — Mixed',
      '',
      '**Narrator:** Ser observers watch SER and serious ser.',
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(md, { imageFiles: {}, foreignWords: ['ser'] })
    // All case variants of the whole word highlight…
    expect(html).toContain('<strong class="foreign">Ser</strong> observers watch')
    expect(html).toContain('<strong class="foreign">SER</strong>')
    expect(html).toContain('<strong class="foreign">ser</strong>.')
    // …but "ser" inside "observers"/"serious" never does.
    expect(html).not.toContain('ob<strong class="foreign">')
    expect(html).not.toContain('<strong class="foreign">ser</strong>ious')
  })

  it('ignores invented list entries and never nests author marks', () => {
    const md = [
      '## Step 1 — Marked',
      '',
      '**Narrator:** Say **soy** now, amigo, and adios.',
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(md, {
      imageFiles: {},
      foreignWords: ['soy', 'amigo', 'not in the text', 'say **bold**'],
    })
    // Author marks render once, never nested inside LLM spans.
    expect(html).toContain('<strong class="foreign">soy</strong>')
    expect(html).not.toContain('<strong class="foreign"><strong')
    // Listed words found in the sentence highlight…
    expect(html).toContain('now, <strong class="foreign">amigo</strong>,')
    // …invented entries and entries with markup never leak into the output.
    expect(html).not.toContain('not in the text')
    expect(html).not.toContain('<strong class="foreign">Say</strong>')
    expect(html).toContain('Say <strong class="foreign">soy</strong> now,')
  })

  it('renders plain narrator text when no foreign-word list is given', () => {
    const md = [
      '## Step 1 — Reading',
      '',
      '**Narrator:** The teacher reads the lesson to the class today.',
      '',
      '## Step 2 — Listening',
      '',
      "**Narrator:** Don't stop the music and listen.",
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(md, { imageFiles: {} })
    expect(html).toContain(
      '<p class="narrator">The teacher reads the lesson to the class today.</p>',
    )
    expect(html).toContain('<p class="narrator">Don&#39;t stop the music and listen.</p>')
    expect(html).not.toContain('<strong')
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
    // Fixed tokens on a repeating tilable board.
    expect(html).toContain('--board: #20302A')
    expect(html).toContain('--chalk: #F4F1E8')
    expect(html).toContain('--chalk-dim: #C9CFC4')
    expect(html).toContain('#F2D98C')
    expect(html).toContain("url('assets/board-tile.png')")
    expect(html).toContain('background-repeat: repeat')
    // Crayon Libre headings + body, embedded offline.
    expect(html).toContain('Crayon Libre')
    expect(html).toContain('crayon-libre-regular.woff2')
    expect(html).toContain('crayon-libre-italic.woff2')
    expect(html).toContain("format('woff2')")
    expect(html).not.toContain('Cabin Sketch')
    expect(html).not.toContain('Kalam')
    // Grain + wobble borders, offline fonts, print fallback.
    expect(html).toContain('feTurbulence')
    expect(html).toContain('255px 15px 225px 15px')
    expect(html).toContain('assets/fonts/')
    expect(html).toContain('@media print')
  })

  it('centers and enlarges each label while cycling accent colors by figure order', () => {
    const md = [
      '## Step 1 — Mixed',
      '',
      '![First](asset:first)',
      '',
      '> Brief: First brief.',
      '',
      '> Label: First label',
      '',
      '![Second](asset:second)',
      '',
      '> Brief: Second brief.',
      '',
      '> Label: Second label',
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(md, {
      imageFiles: { first: 'first.png', second: 'second.png' },
    })
    // First label takes the first accent, the next figure the next one —
    // deterministic per figure order, so identical inputs stay byte-identical.
    expect(html).toContain('<figcaption class="accent-yellow">First label</figcaption>')
    expect(html).toContain('<figcaption class="accent-pink">Second label</figcaption>')
    expect(html).toContain('figure.visual figcaption { font-size: 1.15em;')
    expect(html).toContain('text-align: center')
  })

  it('renders body copy bigger than labels and right-aligned', () => {
    const md = [
      '## Step 1 — Reading',
      '',
      '**Narrator:** The teacher reads.',
      '',
      'Some body copy between narrations.',
      '',
      "**Narrator:** Don't stop the music.",
      '',
      'More body copy here.',
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(md, { imageFiles: {} })
    expect(html).toContain(
      '<p class="chalk-text accent-yellow">Some body copy between narrations.</p>',
    )
    expect(html).toContain('<p class="chalk-text accent-pink">More body copy here.</p>')
    expect(html).toContain('p.chalk-text { font-size: 1.3em; text-align: right; }')
  })

  it('renders standalone labels as centered paragraphs sharing the accent cycle', () => {
    const md = [
      '## Step 1 — Mixed',
      '',
      '![First](asset:first)',
      '',
      '> Brief: First brief.',
      '',
      '> Label: Attached label',
      '',
      'Some text in between.',
      '',
      '> Label: Stray label without an open visual',
      '',
    ].join('\n')
    const html = renderScenarioChalkHtml(md, { imageFiles: { first: 'first.png' } })
    // Attached label captions its figure…
    expect(html).toContain('<figcaption class="accent-yellow">Attached label</figcaption>')
    // …while the orphan label renders as its own centered paragraph, next
    // accent in the shared page-wide cycle (the body copy between them took
    // the second slot) — never plain body copy.
    expect(html).toContain(
      '<p class="board-label accent-blue">Stray label without an open visual</p>',
    )
    expect(html).not.toContain('<p class="chalk-text">Stray label')
    expect(html).toContain('p.board-label { font-size: 1.15em;')
    expect(html).toContain('text-align: center')
  })

  it('renders steps with no fill so the board tile shows through', () => {
    const html = renderScenarioChalkHtml(MD, {
      imageFiles: { 'young-doctor-smiling': 'young-doctor-smiling.png' },
    })
    expect(html).not.toContain('--board-erase')
    expect(html).not.toContain('background: var(--board-erase)')
  })

  it('embeds theme assets as data URIs for the srcDoc preview', () => {
    const html = renderScenarioChalkHtml(MD, {
      imageFiles: { 'young-doctor-smiling': 'young-doctor-smiling.png' },
      resolveAssetUrl: (file) => `data:mock/${file}`,
    })
    expect(html).toContain("url('data:mock/fonts/crayon-libre-regular.woff2')")
    expect(html).toContain("url('data:mock/fonts/crayon-libre-italic.woff2')")
    expect(html).toContain("url('data:mock/board-tile.png')")
    expect(html).not.toContain("url('assets/")
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
