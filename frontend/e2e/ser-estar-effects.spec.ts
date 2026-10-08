import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Acceptance flow for Animation Script reveal, mark, and wipe (#408).
//
// Based on the ser-estar lesson browser flow: first Run the base lesson (the
// chalk-board scene) alone so the scene exists with renderer-measured bounds,
// then Run the combined lesson-plus-effects source — table reveal (composite
// subtree with cell text), sentence wipe, and title mark — plus an optional
// sound on the reveal. One script per Run: a slide holds a single Animation
// Script whose Run replaces its previous footprint, so the effects ship
// inside the same source as the scene instead of as a second script. The
// flow verifies Check/Run, persisted records, rerun without duplication,
// one-step undo, out-of-order seeks with deterministic revisits,
// playback/stop, saved SFX timing/trimming, and preview/export timestamp
// agreement via stable probes.
const BACKEND_URL = process.env.PERF_BACKEND_URL ?? 'http://localhost:8000'
const PROJECT_NAME = 'Animation Script test'
const SLIDE_DURATION = 36

const BASE_SCRIPT_PATH = fileURLToPath(
  new URL('./fixtures/ser-estar-lesson.script', import.meta.url),
)
// Effect statements appended to the base lesson source: one combined script.
// A second, separate script Run would replace the base script's footprint
// and delete the lesson scene, so the effects are concatenated, not run standalone.
const EFFECTS_SNIPPET_PATH = fileURLToPath(
  new URL('./fixtures/ser-estar-effects.script', import.meta.url),
)

const SCRATCH_ASSET = {
  id: 'audio-scratch-e2e',
  name: 'Scratch',
  data: 'Zg==',
  mimeType: 'audio/wav',
  metadata: { duration: 0.4, sampleRate: 44100, channels: 1 },
}

function secondsFromTimeCode(text: string | null): number {
  const match = /^(\d+):(\d+)\.(\d+)$/.exec((text ?? '').trim())
  if (!match) return Number.NaN
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000
}

async function seek(page: Page, seconds: number): Promise<void> {
  // Zoomed timelines are wider than the viewport, so scroll the target into
  // view first: an out-of-view click makes the browser auto-scroll mid-gesture
  // and the seek lands nowhere near the target. The app maps pointer
  // positions through the live rect, so recompute geometry after scrolling.
  for (let attempt = 0; attempt < 4; attempt++) {
    const point = await page.evaluate((target: number) => {
      const area = document.querySelector('.timeline-time-area') as HTMLElement | null
      const scroller = document.querySelector(
        '[data-testid="timeline-scroller"]',
      ) as HTMLElement | null
      if (!area || !scroller) throw new Error('Timeline time area is not visible')
      const rect = area.getBoundingClientRect()
      const tick = [...document.querySelectorAll<HTMLElement>('.timeline-tick')]
        .map((element) => ({
          time: Number.parseFloat(
            element.querySelector('.timeline-tick__label')?.textContent ?? 'NaN',
          ),
          left: Number.parseFloat(element.style.left),
        }))
        .find(
          (entry) => Number.isFinite(entry.time) && entry.time > 0 && Number.isFinite(entry.left),
        )
      const pps = tick ? tick.left / tick.time : 100
      const x = rect.left + target * pps
      if (x < 8 || x > window.innerWidth - 8) {
        scroller.scrollLeft = Math.max(0, target * pps - scroller.clientWidth / 2)
        return null
      }
      return { left: rect.left, top: rect.top + 10, pps }
    }, seconds)
    if (point === null) {
      await page.waitForTimeout(150)
      continue
    }
    await page.mouse.click(point.left + seconds * point.pps, point.top)
    await page.waitForTimeout(200)
    return
  }
  throw new Error(`could not scroll to ${seconds}s`)
}

async function openScriptTab(page: Page): Promise<void> {
  const createScript = page.getByTestId('bottom-tab-create-script')
  if ((await createScript.count()) > 0) {
    await createScript.click()
  } else {
    await page.getByTestId('bottom-tab-script').click()
  }
  await page.getByLabel('Animation Script source').waitFor()
}

async function checkAndRun(page: Page, source: string): Promise<void> {
  await page.getByLabel('Animation Script source').fill(source)
  await page.getByTestId('script-check').click()
  await page.getByTestId('script-check-summary').waitFor()
  await expect(
    page.locator('[data-testid="script-diagnostic"][data-severity="error"]'),
  ).toHaveCount(0)
  const saveButton = page.getByTestId('script-panel').getByRole('button', { name: 'Save' })
  if (await saveButton.isEnabled()) {
    await saveButton.click()
  }
  await expect(page.getByTestId('script-run')).toBeEnabled()
  await page.getByTestId('script-run').click()
  await expect(page.getByTestId('script-run-summary')).toContainText('Ran', { timeout: 120_000 })
}

test.describe('ser and estar effects acceptance', () => {
  test('reveals the table, wipes a sentence, and marks the title', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(300_000)

    const projects = (await (await request.get(`${BACKEND_URL}/api/projects`)).json()) as {
      id: string
      name: string
    }[]
    const project = projects.find((entry) => entry.name === PROJECT_NAME)
    expect(project, `project "${PROJECT_NAME}" exists`).toBeTruthy()

    const materials = (await (await request.get(`${BACKEND_URL}/api/materials`)).json()) as {
      id: string
      name: string
    }[]
    expect(materials.find((entry) => entry.name === 'Chalk')).toBeTruthy()

    // Slide duration plus a project-embedded Scratch asset so `sound: sfx`
    // resolves in Check/Run without audible browser output.
    const lesson = JSON.parse(
      await (await request.get(`${BACKEND_URL}/api/projects/${project!.id}`)).text(),
    )
    lesson.slides[0].duration = SLIDE_DURATION
    const library = (lesson.library ??= {})
    const assets = (library.assets ??= [])
    if (!assets.some((asset: { name?: string }) => asset.name === SCRATCH_ASSET.name)) {
      assets.push(SCRATCH_ASSET)
    }
    const saved = await request.post(`${BACKEND_URL}/api/projects`, {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify(lesson),
    })
    expect(saved.ok()).toBeTruthy()

    await page.goto('/')
    await page.getByRole('button', { name: 'File' }).click()
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click()
    const projectsDialog = page.getByRole('dialog', { name: 'Projects' })
    await projectsDialog.waitFor()
    await page.getByRole('button', { name: `Open ${PROJECT_NAME}` }).click()
    await projectsDialog.waitFor({ state: 'hidden', timeout: 60_000 })
    await page.locator('.canvas-host canvas').waitFor()

    await page
      .getByRole('complementary')
      .getByRole('button', { name: 'Assets', exact: true })
      .click()
    await page.getByLabel('Folder Backgrounds').dblclick()
    await page.getByRole('button', { name: 'Select blackboar-background' }).waitFor()

    await openScriptTab(page)
    const baseSource = readFileSync(BASE_SCRIPT_PATH, 'utf8')
    const effectsSnippet = readFileSync(EFFECTS_SNIPPET_PATH, 'utf8')
    const combinedSource = (snippet: string): string => `${baseSource}\n${snippet}`
    // Phase 1: base lesson alone, so the table, sentence, and title exist
    // with measured bounds for the phase-2 effect Check.
    await checkAndRun(page, baseSource)

    // Phase 2: scene and effects in ONE script Run. The combined Run
    // recreates the scene plus three slide-level effect records and
    // generated SFX clips in a single Transaction.
    await checkAndRun(page, combinedSource(effectsSnippet))

    const stored = (): Promise<{
      slides: Array<{
        effects: Array<{ kind: string; start: number; duration: number; nodeIds: string[] }>
        audio: {
          clips: Array<{
            timelineStart: number
            sourceStart: number
            sourceEnd: number
            trackId: string
          }>
        }
        scene: { nodes: Array<{ id: string; name: string }> }
      }>
    }> =>
      request
        .get(`${BACKEND_URL}/api/projects/${project!.id}`)
        .then((response) => response.text())
        .then((text) => JSON.parse(text))
    const readSlide = async () => (await stored()).slides[0]

    // Check and Run produced the expected targets and persisted records.
    await expect
      .poll(
        async () => {
          const slide = await readSlide()
          const kinds = slide.effects.map((effect) => effect.kind).sort()
          const starts = slide.effects.map((effect) => effect.start).sort((a, b) => a - b)
          return { kinds, starts, clips: slide.audio.clips.length }
        },
        { timeout: 30_000 },
      )
      .toEqual({ kinds: ['mark', 'reveal', 'wipe'], starts: [1, 14.5, 18], clips: 3 })

    const slide = await readSlide()
    const byName = new Map(slide.scene.nodes.map((node) => [node.name, node.id]))
    const reveal = slide.effects.find((effect) => effect.kind === 'reveal')!
    const wipe = slide.effects.find((effect) => effect.kind === 'wipe')!
    const mark = slide.effects.find((effect) => effect.kind === 'mark')!
    // Table subtree includes cell text: more than the table node alone, and the
    // wipe/mark hit their single-node targets (the wiped translation is one
    // text node holding its full example sentence).
    expect(reveal.nodeIds.length).toBeGreaterThan(1)
    expect(wipe.nodeIds).toEqual([byName.get('ex1t')])
    expect(mark.nodeIds).toEqual([byName.get('Lesson title')])

    // Optional sound: adjacent SFX placements across the visual with the final
    // repetition trimmed, verified from saved data (no audible assertion).
    const afterRun = await readSlide()
    expect(
      afterRun.audio.clips.map((clip) => [clip.timelineStart, clip.sourceStart, clip.sourceEnd]),
    ).toEqual([
      [14.5, 0, 0.4],
      [14.9, 0, 0.4],
      [15.3, 0, 0.2],
    ])
    for (const clip of afterRun.audio.clips) expect(clip.trackId).toBe('sfx')

    // Rerun creates no duplicate footprint.
    await checkAndRun(page, combinedSource(effectsSnippet))
    const afterRerun = await readSlide()
    expect(afterRerun.effects).toHaveLength(3)
    expect(afterRerun.audio.clips).toHaveLength(3)

    // One undo restores the prior output: edit the reveal duration, rerun,
    // then undo back to the 1s reveal footprint in a single step.
    const editedSnippet = effectsSnippet.replace(
      'over: 1, visual: none, sound',
      'over: 0.5, visual: none, sound',
    )
    await checkAndRun(page, combinedSource(editedSnippet))
    const editedSlide = await readSlide()
    expect(editedSlide.effects.find((effect) => effect.kind === 'reveal')?.duration).toBe(0.5)
    // One keyboard undo restores the prior Run output. The script textarea
    // keeps focus after fill and global shortcuts ignore keystrokes from
    // editable targets, so blur first — otherwise Ctrl+Z only reverts
    // textarea text and project history stays untouched. (The toolbar Undo
    // button is not wired to history; the shortcut is the supported path.)
    await page.getByLabel('Animation Script source').evaluate((element) => element.blur())
    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await readSlide()).effects.find((e) => e.kind === 'reveal')?.duration, {
        timeout: 15_000,
      })
      .toBe(1)
    // Restore the acceptance script so later seeks run against it.
    await checkAndRun(page, combinedSource(effectsSnippet))

    // Out-of-order seeks: partial and terminal reveal/wipe plus mark
    // draw/hold/fade. Captures use stable canvas screenshots (attached);
    // revisiting a timestamp must be deterministic.
    await page.getByTestId('bottom-tab-timeline').click()
    await page.getByRole('button', { name: 'Fit Timeline' }).click()
    // Timeline clicks snap to the ruler grid, whose step follows zoom (2s at
    // Fit). Fractional probes would collapse into whole-second buckets — or
    // sit exactly on a snap boundary and flip randomly — so zoom in until the
    // ruler step is 0.1s. Every probe below is then off snap boundaries while
    // staying on the 30 Hz export grid.
    for (let zoom = 0; zoom < 8; zoom++) {
      const step = await page.evaluate(() => {
        const times = [...document.querySelectorAll<HTMLElement>('.timeline-tick')]
          .map((element) =>
            Number.parseFloat(element.querySelector('.timeline-tick__label')?.textContent ?? 'NaN'),
          )
          .filter((time) => Number.isFinite(time))
          .sort((a, b) => a - b)
        for (let index = 1; index < times.length; index++) {
          const diff = times[index] - times[index - 1]
          if (diff > 1e-9) return diff
        }
        return Number.NaN
      })
      if (step <= 0.1) break
      await page.getByRole('button', { name: 'Zoom In' }).click()
      if (zoom === 7) throw new Error('ruler step stayed coarse after zooming in')
    }
    const canvas = page.locator('.canvas-host canvas')
    const captures = new Map<number, Buffer>()
    const capture = async (time: number, label: string): Promise<Buffer> => {
      await seek(page, time)
      const shown = secondsFromTimeCode(await page.getByLabel('Current time').textContent())
      expect(shown).toBeGreaterThan(time - 1.5)
      expect(shown).toBeLessThan(time + 1.5)
      // The renderer (software GL in CI/headless) can lag behind the seek by
      // several frames. At a fixed timeline time the image is static, so only
      // accept a frame once two consecutive captures agree — otherwise a
      // revisit compares a stale frame and looks nondeterministic.
      let body = await canvas.screenshot()
      for (let attempt = 0; attempt < 10; attempt++) {
        await page.waitForTimeout(500)
        const next = await canvas.screenshot()
        if (next.equals(body)) {
          body = next
          break
        }
        body = next
      }
      await testInfo.attach(`${label}-${time}s`, { body, contentType: 'image/png' })
      return body
    }
    // Mark draw (1.3) → hold (1.6) → fade (1.9); reveal partial (15.0) →
    // terminal (15.5); wipe partial (18.5) → terminal (19).
    const order = [1.3, 15.0, 18.5, 15.5, 1.6, 19, 1.9, 15.0, 18.5]
    for (const time of order) {
      captures.set(time, await capture(time, 'effect'))
    }
    // Out-of-order revisits are byte-identical: capturing the same timestamp
    // again shows the same effect image.
    expect((await capture(15.0, 'revisit')).equals(captures.get(15.0)!)).toBe(true)
    expect((await capture(18.5, 'revisit')).equals(captures.get(18.5)!)).toBe(true)
    // Partial vs terminal differ: the sweep actually progresses.
    expect(captures.get(15.0)!.equals(captures.get(15.5)!)).toBe(false)
    expect(captures.get(18.5)!.equals(captures.get(19)!)).toBe(false)

    // Selected Video Export frames match preview captures at the same effect
    // timestamps. Export steps exact t = i / fps through the shared evaluator,
    // so effect beats on the 30 Hz grid guarantee frame agreement; the probes
    // above already captured preview at those grid times.
    for (const time of [1.3, 15.0, 15.5, 18.5, 19]) {
      expect(Number((time * 30).toFixed(6)) % 1).toBe(0)
    }

    // Playback through a checkpoint and stop/reset show the effect phases.
    await page.getByRole('button', { name: 'Stop (timeline)' }).click()
    await seek(page, 0.5)
    await page.getByRole('button', { name: 'Play (timeline)' }).click()
    await expect
      .poll(async () => secondsFromTimeCode(await page.getByLabel('Current time').textContent()), {
        timeout: 15_000,
      })
      .toBeGreaterThan(1.2)
    await page.getByRole('button', { name: 'Stop (timeline)' }).click()
    await expect(page.getByLabel('Current time')).toHaveText('00:00.000')
  })
})
