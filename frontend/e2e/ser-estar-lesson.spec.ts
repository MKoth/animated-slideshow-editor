import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The lesson target: slide 1 of the stored project "Animation Script test".
const BACKEND_URL = process.env.PERF_BACKEND_URL ?? 'http://localhost:8000'
const PROJECT_NAME = 'Animation Script test'
const SLIDE_DURATION = 36

// The lesson itself, authored in the Animation Script language. The same file
// can be pasted by hand into the Script tab.
const SCRIPT_PATH = fileURLToPath(new URL('./fixtures/ser-estar-lesson.script', import.meta.url))

const FRAME_TIMES = [2, 7, 14.5, 27]

function secondsFromTimeCode(text: string | null): number {
  const match = /^(\d+):(\d+)\.(\d+)$/.exec((text ?? '').trim())
  if (!match) return Number.NaN
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000
}

async function seek(page: Page, seconds: number): Promise<void> {
  // Pixels-per-second comes from a ruler tick (the time area is wider than the
  // duration by a trailing scroll pad, so width/duration would drift).
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
  await page.waitForTimeout(150)
}

test.describe('ser and estar lesson', () => {
  test('applies the Animation Script to "Animation Script test"', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000)

    // `create asset` resolves by asset-library name, and the library only
    // registers the folder it is browsing — the background lives in
    // "Backgrounds". The Run then embeds the asset snapshot into the project,
    // so the .lesson stays self-contained.
    const projects = (await (await request.get(`${BACKEND_URL}/api/projects`)).json()) as {
      id: string
      name: string
    }[]
    const project = projects.find((entry) => entry.name === PROJECT_NAME)
    expect(project, `project "${PROJECT_NAME}" exists`).toBeTruthy()

    // The lesson binds `material("Chalk")` and assigns it to its group. The
    // backend seeds the Chalk shader and material as built-ins on startup, so
    // a running backend older than the seed needs a restart before this test.
    const materials = (await (await request.get(`${BACKEND_URL}/api/materials`)).json()) as {
      id: string
      name: string
    }[]
    const chalk = materials.find((entry) => entry.name === 'Chalk')
    expect(chalk, 'the built-in Chalk material is seeded').toBeTruthy()

    // The lesson needs more than the stored 10 seconds. Patch the slide
    // duration through the same endpoint the editor saves with.
    const lesson = JSON.parse(
      await (await request.get(`${BACKEND_URL}/api/projects/${project!.id}`)).text(),
    )
    lesson.slides[0].duration = SLIDE_DURATION
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
    // The project embeds the background PNG, so its .lesson is tens of MB and
    // the open can take longer than the default action timeout.
    await projectsDialog.waitFor({ state: 'hidden', timeout: 60_000 })
    await page.locator('.canvas-host canvas').waitFor()

    await page
      .getByRole('complementary')
      .getByRole('button', { name: 'Assets', exact: true })
      .click()
    await page.getByLabel('Folder Backgrounds').dblclick()
    await page.getByRole('button', { name: 'Select blackboar-background' }).waitFor()

    // The Script tab alone must resolve `material("Chalk")`: Check/Run load the
    // material and shader libraries themselves, without a Materials panel visit.
    // Open the Script tab, creating the slide's script on first run.
    const createScript = page.getByTestId('bottom-tab-create-script')
    if ((await createScript.count()) > 0) {
      await createScript.click()
    } else {
      await page.getByTestId('bottom-tab-script').click()
    }

    const source = readFileSync(SCRIPT_PATH, 'utf8')
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
    await expect(page.getByTestId('script-run-summary')).toContainText('Ran', {
      timeout: 120_000,
    })
    await expect(page.getByTestId('script-run-summary')).toContainText(/\d+ created nodes/)
    await expect(
      page.locator('[data-testid="script-diagnostic"][data-severity="error"]'),
    ).toHaveCount(0)

    // The editor auto-saves after the Run. Read the stored .lesson back and
    // check the created table landed in the right shape: one table, and every
    // cell text inside the cell its selector named (a re-run must replace the
    // previous output, not shift the grid). Everything but the background sits
    // under the one "Lesson board" group, and the group carries the Chalk
    // material, so the whole lesson renders through the grain shader.
    await expect
      .poll(
        async () => {
          const stored = JSON.parse(
            await (await request.get(`${BACKEND_URL}/api/projects/${project!.id}`)).text(),
          )
          const nodes = stored.slides[0].scene.nodes as {
            id: string
            name: string
            parentId?: string
            material?: { definitionId?: string }
          }[]
          const byId = new Map(nodes.map((node) => [node.id, node]))
          const parentNameOf = (name: string) => {
            const node = nodes.find((candidate) => candidate.name === name)
            return node?.parentId === undefined ? null : (byId.get(node.parentId)?.name ?? null)
          }
          const board = nodes.find((node) => node.name === 'Lesson board')
          return {
            tables: nodes.filter((node) => node.name === 'Grammar table').length,
            header: parentNameOf('Cell header pronoun'),
            yo: parentNameOf('Cell yo'),
            estan: parentNameOf('Cell estan'),
            boards: nodes.filter((node) => node.name === 'Lesson board').length,
            titleParent: parentNameOf('Lesson title'),
            tableParent: parentNameOf('Grammar table'),
            boardMaterial: board?.material?.definitionId ?? null,
          }
        },
        { timeout: 30_000 },
      )
      .toEqual({
        tables: 1,
        header: 'Cell 1,1',
        yo: 'Cell 2,1',
        estan: 'Cell 7,3',
        boards: 1,
        titleParent: 'Lesson board',
        tableParent: 'Lesson board',
        boardMaterial: chalk!.id,
      })

    // Review frames: scrub to each checkpoint and attach a canvas capture.
    await page.getByTestId('bottom-tab-timeline').click()
    await page.getByRole('button', { name: 'Fit Timeline' }).click()
    const canvas = page.locator('.canvas-host canvas')
    for (const time of FRAME_TIMES) {
      await seek(page, time)
      const shown = secondsFromTimeCode(await page.getByLabel('Current time').textContent())
      // The seek snaps to the ruler's tick step, so accept the neighbouring tick.
      expect(shown).toBeGreaterThan(time - 1.5)
      expect(shown).toBeLessThan(time + 1.5)
      await testInfo.attach(`frame-${time}s`, {
        body: await canvas.screenshot(),
        contentType: 'image/png',
      })
    }

    // Playback really runs (the keyframes evaluate) and Stop resets to zero.
    await page.getByRole('button', { name: 'Stop (timeline)' }).click()
    await page.getByRole('button', { name: 'Play (timeline)' }).click()
    await expect
      .poll(async () => secondsFromTimeCode(await page.getByLabel('Current time').textContent()), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0.5)
    await page.getByRole('button', { name: 'Stop (timeline)' }).click()
    await expect(page.getByLabel('Current time')).toHaveText('00:00.000')
  })
})
