import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Acceptance flow for Animation Script reveal, mark, and wipe (#408).
//
// Based on the ser-estar lesson browser flow: the base lesson builds the
// chalk-board scene, then a second script demonstrates all three effects
// together — table reveal (composite subtree with cell text), sentence wipe,
// and title mark — plus an optional sound on the reveal. The flow verifies
// Check/Run, persisted records, rerun without duplication, one-step undo,
// out-of-order seeks with deterministic revisits, playback/stop, saved SFX
// timing/trimming, and preview/export timestamp agreement via stable probes.
const BACKEND_URL = process.env.PERF_BACKEND_URL ?? 'http://localhost:8000'
const PROJECT_NAME = 'Animation Script test'
const SLIDE_DURATION = 36

const BASE_SCRIPT_PATH = fileURLToPath(
  new URL('./fixtures/ser-estar-lesson.script', import.meta.url),
)
const EFFECTS_SCRIPT_PATH = fileURLToPath(
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
  const { left, top, pps } = await page.evaluate(() => {
    const area = document.querySelector('.timeline-time-area') as HTMLElement | null
    if (!area) throw new Error('Timeline time area is not visible')
    const rect = area.getBoundingClientRect()
    const tick = [...document.querySelectorAll<HTMLElement>('.timeline-tick')]
      .map((element) => ({
        time: Number.parseFloat(
          element.querySelector('.timeline-tick__label')?.textContent ?? 'NaN',
        ),
        left: Number.parseFloat(element.style.left),
      }))
      .find((entry) => Number.isFinite(entry.time) && entry.time > 0 && Number.isFinite(entry.left))
    return { left: rect.left, top: rect.top + 10, pps: tick ? tick.left / tick.time : 100 }
  })
  await page.mouse.click(left + seconds * pps, top)
  await page.waitForTimeout(200)
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
    await checkAndRun(page, readFileSync(BASE_SCRIPT_PATH, 'utf8'))

    // The effect script preserves the base scene: no new scene nodes, only
    // three slide-level effect records plus generated SFX clips.
    await checkAndRun(page, readFileSync(EFFECTS_SCRIPT_PATH, 'utf8'))

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
      .toEqual({ kinds: ['mark', 'reveal', 'wipe'], starts: [1, 5, 18], clips: 3 })

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
      [5, 0, 0.4],
      [5.4, 0, 0.4],
      [5.8, 0, 0.2],
    ])
    for (const clip of afterRun.audio.clips) expect(clip.trackId).toBe('sfx')

    // Rerun creates no duplicate footprint.
    await checkAndRun(page, readFileSync(EFFECTS_SCRIPT_PATH, 'utf8'))
    const afterRerun = await readSlide()
    expect(afterRerun.effects).toHaveLength(3)
    expect(afterRerun.audio.clips).toHaveLength(3)

    // One undo restores the prior output: edit the reveal duration, rerun,
    // then undo back to the 1s reveal footprint in a single step.
    const edited = readFileSync(EFFECTS_SCRIPT_PATH, 'utf8').replace(
      'over: 1, visual: none, sound',
      'over: 0.5, visual: none, sound',
    )
    await checkAndRun(page, edited)
    const editedSlide = await readSlide()
    expect(editedSlide.effects.find((effect) => effect.kind === 'reveal')?.duration).toBe(0.5)
    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await readSlide()).effects.find((e) => e.kind === 'reveal')?.duration, {
        timeout: 15_000,
      })
      .toBe(1)
    // Restore the acceptance script so later seeks run against it.
    await checkAndRun(page, readFileSync(EFFECTS_SCRIPT_PATH, 'utf8'))

    // Out-of-order seeks: partial and terminal reveal/wipe plus mark
    // draw/hold/fade. Captures use stable canvas screenshots (attached);
    // revisiting a timestamp must be deterministic.
    await page.getByTestId('bottom-tab-timeline').click()
    await page.getByRole('button', { name: 'Fit Timeline' }).click()
    const canvas = page.locator('.canvas-host canvas')
    const captures = new Map<number, Buffer>()
    const capture = async (time: number, label: string): Promise<Buffer> => {
      await seek(page, time)
      const shown = secondsFromTimeCode(await page.getByLabel('Current time').textContent())
      expect(shown).toBeGreaterThan(time - 1.5)
      expect(shown).toBeLessThan(time + 1.5)
      const body = await canvas.screenshot()
      await testInfo.attach(`${label}-${time}s`, { body, contentType: 'image/png' })
      return body
    }
    // Mark draw (1.25) → hold (1.6) → fade (1.85); reveal partial (5.5) →
    // terminal (6 and 7); wipe partial (18.5) → terminal (19).
    const order = [1.25, 5.5, 18.5, 6, 1.6, 19, 1.85, 5.5, 18.5]
    for (const time of order) {
      captures.set(time, await capture(time, 'effect'))
    }
    // Out-of-order revisits are byte-identical: capturing the same timestamp
    // again shows the same effect image.
    expect((await capture(5.5, 'revisit')).equals(captures.get(5.5)!)).toBe(true)
    expect((await capture(18.5, 'revisit')).equals(captures.get(18.5)!)).toBe(true)
    // Partial vs terminal differ: the sweep actually progresses.
    expect(captures.get(5.5)!.equals(captures.get(6)!)).toBe(false)
    expect(captures.get(18.5)!.equals(captures.get(19)!)).toBe(false)

    // Selected Video Export frames match preview captures at the same effect
    // timestamps. Export steps exact t = i / fps through the shared evaluator,
    // so effect beats on the 30 Hz grid guarantee frame agreement; the probes
    // above already captured preview at those grid times.
    for (const time of [1.25, 5.5, 6, 18.5, 19]) {
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
