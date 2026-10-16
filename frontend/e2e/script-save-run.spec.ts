import { test, expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Save/run flow for `paw-visuals-test.script` (frontend/e2e/fixtures/).
//
// Creates the demo scene, then adds effects after render measurement is
// available, mirroring the editor's script-check constraints.
//
// The panel keeps two values: `draft` (textarea) and `source` (saved
// script). Check compiles the draft; Run executes the saved source and stays
// disabled while dirty. Each phase pins that contract:
//  1. pasting disables Run ("Save your changes before running") while Check
//     runs against the draft with no errors;
//  2. Save enables Run and Run creates the nodes (asserted via
//     GET /api/projects/<id>, as the ser-estar specs do).
const BACKEND_URL = process.env.PERF_BACKEND_URL ?? 'http://localhost:8000'
const PROJECT_NAME = 'Paw save-run e2e'

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/paw-visuals-test.script', import.meta.url))
const FULL_SOURCE = readFileSync(FIXTURE_PATH, 'utf8')
const EFFECTS_MARKER = '// ── EFFECTS ──'
const SETUP_SOURCE = FULL_SOURCE.slice(0, FULL_SOURCE.indexOf(EFFECTS_MARKER)).trimEnd() + '\n'
const PAW_NAMES = ['paw with chalk', 'paw with rag', 'paw empty'] as const
const TEXT_NAMES = ['Demo title', 'Wipe me', 'Reveal me'] as const
const KNOWN_NAMES = [...TEXT_NAMES, ...PAW_NAMES]

async function listProjects(request: APIRequestContext): Promise<{ id: string; name: string }[]> {
  return (await (await request.get(`${BACKEND_URL}/api/projects`)).json()) as {
    id: string
    name: string
  }[]
}

async function findProjectId(request: APIRequestContext, name: string): Promise<string | null> {
  const projects = await listProjects(request)
  return projects.find((entry) => entry.name === name)?.id ?? null
}

async function readSceneNodeNames(request: APIRequestContext, id: string): Promise<string[]> {
  const stored = JSON.parse(
    await (await request.get(`${BACKEND_URL}/api/projects/${id}`)).text(),
  ) as { slides: { scene: { nodes: { name: string }[] } }[] }
  return stored.slides[0].scene.nodes
    .map((node) => node.name)
    .filter((name) => KNOWN_NAMES.includes(name))
    .sort()
}

async function readEffectKinds(
  request: APIRequestContext,
  id: string,
): Promise<{ kinds: string[]; starts: number[] }> {
  const stored = JSON.parse(
    await (await request.get(`${BACKEND_URL}/api/projects/${id}`)).text(),
  ) as { slides: { effects: { kind: string; start: number }[] }[] }
  const effects = stored.slides[0].effects ?? []
  return {
    kinds: effects.map((effect) => effect.kind).sort(),
    starts: effects.map((effect) => effect.start).sort((a, b) => a - b),
  }
}

async function readEmbeddedAssetNames(request: APIRequestContext, id: string): Promise<string[]> {
  const stored = JSON.parse(
    await (await request.get(`${BACKEND_URL}/api/projects/${id}`)).text(),
  ) as { library?: { assets?: { name: string }[] } }
  return (stored.library?.assets ?? []).map((asset) => asset.name).sort()
}

async function findAssetId(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.get(
    `${BACKEND_URL}/api/assets?search=${encodeURIComponent(name)}&sort=name&order=asc`,
  )
  const assets = (await response.json()) as { id: string; name: string }[]
  const hit = assets.find((asset) => asset.name === name)
  expect(hit, `asset "${name}" exists in the library`).toBeTruthy()
  return hit!.id
}

async function openFreshProject(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click()
  const projectsDialog = page.getByRole('dialog', { name: 'Projects' })
  await projectsDialog.waitFor()
  await projectsDialog.getByRole('button', { name: 'New Project' }).click()
  await page.getByLabel('Project name').fill(PROJECT_NAME)
  await projectsDialog.getByRole('button', { name: 'Create Project' }).click()
  await projectsDialog.waitFor({ state: 'hidden', timeout: 60_000 })
  await page.locator('.canvas-host canvas').waitFor()
  await expect(page.locator('.menu-bar__title')).toHaveText(PROJECT_NAME)
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

async function seek(page: Page, seconds: number): Promise<void> {
  const point = await page.evaluate((target) => {
    const area = document.querySelector('.timeline-time-area') as HTMLElement | null
    const scroller = document.querySelector(
      '[data-testid="timeline-scroller"]',
    ) as HTMLElement | null
    if (!area || !scroller) throw new Error('Timeline time area is not visible')
    const tick = [...document.querySelectorAll<HTMLElement>('.timeline-tick')]
      .map((element) => ({
        time: Number.parseFloat(
          element.querySelector('.timeline-tick__label')?.textContent ?? 'NaN',
        ),
        left: Number.parseFloat(element.style.left),
      }))
      .find((entry) => entry.time > 0 && Number.isFinite(entry.left))
    const pps = tick ? tick.left / tick.time : 100
    const rect = area.getBoundingClientRect()
    const x = rect.left + target * pps
    if (x < 8 || x > window.innerWidth - 8) {
      scroller.scrollLeft = Math.max(0, target * pps - scroller.clientWidth / 2)
      return null
    }
    return { x, y: rect.top + 10 }
  }, seconds)
  if (!point) {
    await page.waitForTimeout(150)
    return seek(page, seconds)
  }
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(200)
}

async function captureAt(page: Page, testInfo: TestInfo, seconds: number): Promise<void> {
  await seek(page, seconds)
  const canvas = page.locator('.canvas-host canvas')
  let body = await canvas.screenshot()
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForTimeout(300)
    const next = await canvas.screenshot()
    if (next.equals(body)) {
      body = next
      break
    }
    body = next
  }
  await testInfo.attach(`paw-demo-${seconds}s`, { body, contentType: 'image/png' })
}

test.describe('paw visuals save/run', () => {
  test('complete paw scene saves, runs, reopens and renders', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(240_000)

    // Fixed name with pre-test cleanup so the backend lookup below is
    // unambiguous across repeated runs.
    for (const entry of await listProjects(request)) {
      if (entry.name === PROJECT_NAME) {
        await request.delete(`${BACKEND_URL}/api/projects/${entry.id}`)
      }
    }
    for (const name of PAW_NAMES) {
      await findAssetId(request, name)
    }
    const stale = (await listProjects(request)).filter(
      (entry) => entry.name === 'Script save-run e2e',
    )
    for (const entry of stale) await request.delete(`${BACKEND_URL}/api/projects/${entry.id}`)

    await openFreshProject(page)
    const projectId = await expect
      .poll(() => findProjectId(request, PROJECT_NAME), { timeout: 30_000 })
      .not.toBeNull()
      .then(async () => (await findProjectId(request, PROJECT_NAME)) as string)

    await openScriptTab(page)
    const editor = page.getByLabel('Animation Script source')
    const runButton = page.getByTestId('script-run')
    const saveButton = page.getByTestId('script-panel').getByRole('button', { name: 'Save' })
    const errorDiagnostics = page.locator(
      '[data-testid="script-diagnostic"][data-severity="error"]',
    )

    await editor.fill(SETUP_SOURCE)
    await expect(runButton).toBeDisabled()
    await expect(runButton).toHaveAttribute('title', 'Save your changes before running')
    await expect(saveButton).toBeEnabled()

    await page.getByTestId('script-check').click()
    await page.getByTestId('script-check-summary').waitFor()
    await expect(errorDiagnostics).toHaveCount(0)
    await expect(page.getByTestId('script-check-summary')).toContainText(/7 created nodes/)
    await expect(runButton).toBeDisabled()

    // Save enables Run; one run creates the backdrop, performers and text.
    await saveButton.click()
    await expect(runButton).toBeEnabled()
    await expect(saveButton).toBeDisabled()
    await runButton.click()
    await expect(page.getByTestId('script-run-summary')).toContainText('Ran', { timeout: 60_000 })
    await expect(page.getByTestId('script-run-summary')).toContainText(/7 created nodes/)
    await expect(errorDiagnostics).toHaveCount(0)
    await expect
      .poll(() => readSceneNodeNames(request, projectId), { timeout: 30_000 })
      .toEqual([...TEXT_NAMES, ...PAW_NAMES].sort())
    await expect
      .poll(() => readEmbeddedAssetNames(request, projectId), { timeout: 60_000 })
      .toEqual([...PAW_NAMES, 'blackboar-background'].sort())

    // Render once before adding effects so the checker can measure the newly
    // created text bounds; the final saved source recreates the complete scene.
    await editor.fill(FULL_SOURCE)
    await page.getByTestId('script-check').click()
    await page.getByTestId('script-check-summary').waitFor()
    await expect(errorDiagnostics).toHaveCount(0)
    await expect(page.getByTestId('script-check-summary')).toContainText(/7 created nodes/)
    await saveButton.click()
    await runButton.click()
    await expect(page.getByTestId('script-run-summary')).toContainText('Ran', { timeout: 60_000 })

    // The Run persisted the three effect records and kept its footprint to
    // the text and three performers — no duplication.
    await expect
      .poll(() => readEffectKinds(request, projectId), { timeout: 30_000 })
      .toEqual({ kinds: ['mark', 'reveal', 'wipe'], starts: [1.5, 3.5, 5.5] })
    await expect
      .poll(() => readSceneNodeNames(request, projectId), { timeout: 30_000 })
      .toEqual([...TEXT_NAMES, ...PAW_NAMES].sort())

    await page.getByRole('tab', { name: 'Timeline' }).click()
    for (const time of [1.7, 3.7, 5.7]) await captureAt(page, testInfo, time)

    // Re-running the saved source replaces its footprint instead of duplicating it.
    await openScriptTab(page)
    await expect(runButton).toBeEnabled()
    await runButton.click()
    await expect(page.getByTestId('script-run-summary')).toContainText('Ran', { timeout: 60_000 })
    await expect
      .poll(() => readSceneNodeNames(request, projectId), { timeout: 30_000 })
      .toEqual([...TEXT_NAMES, ...PAW_NAMES].sort())

    // Re-opening the project must not report the live-library performers as
    // missing: reconciliation runs against the full library, not the
    // folder-scoped Assets-panel listing.
    await page.reload()
    await page.getByRole('button', { name: 'File' }).click()
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click()
    const reopenDialog = page.getByRole('dialog', { name: 'Projects' })
    await reopenDialog.waitFor()
    await page.getByRole('button', { name: `Open ${PROJECT_NAME}` }).click()
    await reopenDialog.waitFor({ state: 'hidden', timeout: 60_000 })
    await page.locator('.canvas-host canvas').waitFor()
    await expect(page.locator('.menu-bar__title')).toHaveText(PROJECT_NAME)
    // Render the scene tree with the performers as a positive control, then
    // let the post-open reconciliation settle before asserting its verdict:
    // on the old folder-scoped check the dialog is already up by now.
    await page.locator('.left-sidebar').getByRole('button', { name: 'Scene', exact: true }).click()
    for (const name of PAW_NAMES) {
      await expect(page.locator('.scene-tree__row', { hasText: name }).first()).toBeVisible()
    }
    await page.waitForTimeout(1500)
    await expect(page.getByRole('dialog', { name: 'Missing assets' })).toHaveCount(0)
    await expect(page.locator('.scene-tree__indicator--missing')).toHaveCount(0)
  })
})
