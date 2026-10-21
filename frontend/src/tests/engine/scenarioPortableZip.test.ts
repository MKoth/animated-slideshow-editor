import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import {
  SCENARIO_ZIP_BLOCK_BYTES,
  SCENARIO_ZIP_FORMAT,
  SCENARIO_ZIP_MANIFEST_NAME,
  SCENARIO_ZIP_PAGE_NAME,
  SCENARIO_ZIP_WARN_BYTES,
  assertScenarioHtmlPortable,
  buildScenarioPortablePack,
  checkScenarioZipSize,
  encodeScenarioPortableZip,
  estimateScenarioZipBytes,
  sanitizeScenarioZipFilename,
} from '../../engine/scenarioPortableZip'

const MD = [
  '## Step 1 — Who you are',
  '',
  '**Narrator:** Ser is for who you are.',
  '',
  '![Young doctor smiling](asset:young-doctor-smiling)',
  '',
  '> Brief: Warm portrait.',
  '',
  'You say soy.',
  '',
  '## Step 2 — Where you are',
  '',
  '![Empty classroom chairs](asset:empty-classroom-chairs)',
  '',
  '<!-- reuse: Classroom Chairs -->',
  '',
  'Estamos en clase.',
  '',
].join('\n')

function pack() {
  return buildScenarioPortablePack({
    markdown: MD,
    imageFiles: {
      'young-doctor-smiling': 'young-doctor-smiling.png',
      'empty-classroom-chairs': 'empty-classroom-chairs.png',
    },
    imageBytes: {
      'young-doctor-smiling': {
        bytes: new Uint8Array([1, 2, 3]),
        mime: 'image/png',
        alt: 'Young doctor smiling',
        brief: 'Warm portrait.',
      },
      'empty-classroom-chairs': {
        bytes: new Uint8Array([4, 5, 6]),
        mime: 'image/png',
        alt: 'Empty classroom chairs',
      },
    },
    title: 'Scenario',
  })
}

describe('scenarioPortableZip pure seam (issue #465)', () => {
  it('zip contains the top-level page plus an assets folder file per visual plus fonts plus manifest', () => {
    const built = pack()
    expect(built.pageName).toBe(SCENARIO_ZIP_PAGE_NAME)
    expect(built.manifestName).toBe(SCENARIO_ZIP_MANIFEST_NAME)
    // Top-level page.
    expect(built.files[SCENARIO_ZIP_PAGE_NAME]).toBeDefined()
    // One file per visual inside assets/.
    expect(built.files['assets/young-doctor-smiling.png']).toBeDefined()
    expect(built.files['assets/empty-classroom-chairs.png']).toBeDefined()
    // Embedded Crayon Libre plus license text, plus the board tile.
    expect(built.files['assets/board-tile.png']).toBeDefined()
    expect(built.compression['assets/board-tile.png']).toBe('store')
    const fontEntries = Object.keys(built.files).filter((p) => p.startsWith('assets/fonts/'))
    expect(fontEntries).toHaveLength(3)
    expect(fontEntries.some((p) => p.endsWith('.woff2'))).toBe(true)
    expect(built.files['assets/fonts/crayon-libre-regular.woff2']).toBeDefined()
    expect(built.files['assets/fonts/crayon-libre-italic.woff2']).toBeDefined()
    expect(built.files['assets/fonts/FONT-LICENSE.txt']).toBeDefined()
    expect(fontEntries.some((p) => p.toLowerCase().includes('license'))).toBe(true)
    // Manifest port contract.
    const manifestRaw = built.files[SCENARIO_ZIP_MANIFEST_NAME]
    expect(manifestRaw).toBeDefined()
    const manifest = JSON.parse(new TextDecoder().decode(manifestRaw!))
    expect(manifest.format).toBe(SCENARIO_ZIP_FORMAT)
    expect(typeof manifest.generator).toBe('string')
    expect(manifest.generator.length).toBeGreaterThan(0)
    expect(manifest.page).toBe(SCENARIO_ZIP_PAGE_NAME)
    expect(Array.isArray(manifest.visuals)).toBe(true)
    expect(manifest.visuals).toHaveLength(2)
    for (const entry of manifest.visuals) {
      expect(typeof entry.asset).toBe('string')
      expect(typeof entry.file).toBe('string')
      expect(typeof entry.mime).toBe('string')
    }
  })

  it('packs caller-supplied theme bytes instead of placeholders', () => {
    const themeFiles = {
      'assets/fonts/crayon-libre-regular.woff2': new Uint8Array([7, 7]),
      'assets/fonts/crayon-libre-italic.woff2': new Uint8Array([8, 8]),
      'assets/board-tile.png': new Uint8Array([9, 9, 9]),
    }
    const built = buildScenarioPortablePack({
      markdown: MD,
      imageFiles: {
        'young-doctor-smiling': 'young-doctor-smiling.png',
        'empty-classroom-chairs': 'empty-classroom-chairs.png',
      },
      imageBytes: {
        'young-doctor-smiling': { bytes: new Uint8Array([1]), mime: 'image/png' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'empty-classroom-chairs': { bytes: new Uint8Array([2]), mime: 'image/png' } as any,
      },
      themeFiles,
    })
    expect([...built.files['assets/board-tile.png']!]).toEqual([9, 9, 9])
    expect([...built.files['assets/fonts/crayon-libre-regular.woff2']!]).toEqual([7, 7])
    expect([...built.files['assets/fonts/crayon-libre-italic.woff2']!]).toEqual([8, 8])
  })

  it('filenames derive from the normalized-key transform with numeric suffixes and traversal sanitization', () => {
    expect(sanitizeScenarioZipFilename('young-doctor-smiling', 'image/png')).toBe(
      'young-doctor-smiling.png',
    )
    // Collision suffixes stay deterministic in first-appearance order.
    const collidingMd = [
      '## Step 1 — Collide',
      '',
      '![A B](asset:a-b)',
      '',
      '![A_B](asset:a_b)',
      '',
    ].join('\n')
    const built = buildScenarioPortablePack({
      markdown: collidingMd,
      imageFiles: { 'a-b': 'a-b.png', a_b: 'a-b-2.png' },
      imageBytes: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'a-b': { bytes: new Uint8Array([1]), mime: 'image/png' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        a_b: { bytes: new Uint8Array([2]), mime: 'image/png' } as any,
      },
    })
    expect(built.imageFiles['a-b']).toBe('a-b.png')
    expect(built.imageFiles['a_b']).toBe('a-b-2.png')
    // Traversal and control characters never escape assets/.
    expect(sanitizeScenarioZipFilename('../../etc/passwd', 'image/png')).not.toContain('..')
    expect(sanitizeScenarioZipFilename('../../etc/passwd', 'image/png')).not.toContain('/')
    expect(sanitizeScenarioZipFilename('a\x00b\x1fc', 'image/png')).toBe('a-b-c.png')
    // Manifest asset name is the authoritative normalized key, not the filename.
    const manifest = JSON.parse(new TextDecoder().decode(built.files['manifest.json']!))
    const assets = manifest.visuals.map((v: { asset: string }) => v.asset).sort()
    expect(assets).toEqual(['a-b', 'a_b'])
  })

  it('page passes a relative-path-only scan rejecting remote URL patterns before zipping', () => {
    const built = pack()
    const html = new TextDecoder().decode(built.files[SCENARIO_ZIP_PAGE_NAME]!)
    expect(() => assertScenarioHtmlPortable(html)).not.toThrow()
    expect(() => assertScenarioHtmlPortable('<img src="https://example.com/a.png">')).toThrow()
    expect(() => assertScenarioHtmlPortable('<img src="http://example.com/a.png">')).toThrow()
    expect(() => assertScenarioHtmlPortable('<script>alert(1)</script>')).toThrow()
    expect(() =>
      buildScenarioPortablePack({
        markdown: MD,
        imageFiles: { 'young-doctor-smiling': 'https://example.com/evil.png' },
        imageBytes: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'young-doctor-smiling': { bytes: new Uint8Array([1]), mime: 'image/png' } as any,
        },
      }),
    ).toThrow()
  })

  it('already-compressed images store without recompression while page and manifest compress', () => {
    const built = pack()
    expect(built.compression[SCENARIO_ZIP_PAGE_NAME]).toBe('deflate')
    expect(built.compression[SCENARIO_ZIP_MANIFEST_NAME]).toBe('deflate')
    expect(built.compression['assets/young-doctor-smiling.png']).toBe('store')
    const bytes = encodeScenarioPortableZip(built)
    // Valid zip that round-trips through unzip.
    const out = unzipSync(bytes)
    expect(out[SCENARIO_ZIP_PAGE_NAME]).toBeDefined()
    expect(out[SCENARIO_ZIP_MANIFEST_NAME]).toBeDefined()
    expect(out['assets/young-doctor-smiling.png']).toBeDefined()
    // Deterministic: identical inputs yield byte-identical zips (fixed mtime).
    const again = encodeScenarioPortableZip(pack())
    expect(bytes.length).toBe(again.length)
    expect([...bytes]).toEqual([...again])
    // Method check on the raw zip: image entries use STORE (0), page uses DEFLATE (8).
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let deflateSeen = false
    let storeSeen = false
    for (let i = 0; i + 30 < bytes.length; i += 1) {
      // Local file header signature PK\x03\x04.
      if (view.getUint32(i, true) === 0x04034b50) {
        const method = view.getUint16(i + 8, true)
        const nameLen = view.getUint16(i + 26, true)
        const extraLen = view.getUint16(i + 28, true)
        const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen))
        if (name === SCENARIO_ZIP_PAGE_NAME || name === SCENARIO_ZIP_MANIFEST_NAME) {
          expect(method).toBe(8)
          deflateSeen = true
        }
        if (name === 'assets/young-doctor-smiling.png') {
          expect(method).toBe(0)
          storeSeen = true
        }
        i += 30 + nameLen + extraLen - 1
      }
    }
    expect(deflateSeen).toBe(true)
    expect(storeSeen).toBe(true)
  })

  it('sizes warn around one hundred megabytes and block around five hundred megabytes', () => {
    expect(SCENARIO_ZIP_WARN_BYTES).toBe(100 * 1024 * 1024)
    expect(SCENARIO_ZIP_BLOCK_BYTES).toBe(500 * 1024 * 1024)
    expect(checkScenarioZipSize(10).status).toBe('ok')
    expect(checkScenarioZipSize(SCENARIO_ZIP_WARN_BYTES + 1).status).toBe('warn')
    expect(checkScenarioZipSize(SCENARIO_ZIP_BLOCK_BYTES + 1).status).toBe('block')
    expect(estimateScenarioZipBytes({ a: new Uint8Array([1, 2, 3]) })).toBe(3)
    // Oversize packs fail gracefully before encoding.
    const huge = {
      bytes: new Uint8Array([1]),
      mime: 'image/png',
    }
    expect(() =>
      buildScenarioPortablePack({
        markdown: '## Step 1 — T\n\n![A](asset:a)\n',
        imageFiles: { a: 'a.png' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        imageBytes: { a: huge } as any,
        sizeOverrideForTest: SCENARIO_ZIP_BLOCK_BYTES + 1,
      }),
    ).toThrow(/500/)
  })
})
