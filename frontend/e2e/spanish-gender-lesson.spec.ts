import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BACKEND_URL = process.env.PERF_BACKEND_URL ?? 'http://localhost:8000'
const SOURCE_PROJECT = 'Scenario test'
const PROJECT_NAME = 'Spanish Gender Scenario'
const SCRIPT_PATH = fileURLToPath(
  new URL('./fixtures/spanish-gender-lesson.script', import.meta.url),
)
const SLIDE_DURATION = 86
const CANVAS_WIDTH = 1090
const CANVAS_HEIGHT = 893
const BACKGROUND_IMAGE_HEIGHT = 4320
const EXPECTED_SOUND_STARTS = [
  0, 8, 12, 25.5, 29, 32.5, 36, 48, 52, 55.5, 56.6, 57.9, 59.3, 60.9, 62.1, 63.4, 64.2, 65, 65.8,
  67, 68.4, 69.2, 70, 70.8, 74.5, 78.5, 82,
]

async function seek(page: import('@playwright/test').Page, seconds: number): Promise<void> {
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
  await page.waitForTimeout(300)
}

async function checkAndRun(page: import('@playwright/test').Page, source: string): Promise<void> {
  await page.getByLabel('Animation Script source').fill(source)
  await page.getByTestId('script-check').click()
  await page.getByTestId('script-check-summary').waitFor()
  await expect(
    page.locator('[data-testid="script-diagnostic"][data-severity="error"]'),
  ).toHaveCount(0)
  const save = page.getByTestId('script-panel').getByRole('button', { name: 'Save' })
  if (await save.isEnabled()) await save.click()
  await expect(page.getByTestId('script-run')).toBeEnabled()
  await page.getByTestId('script-run').click()
  await expect(page.getByTestId('script-run-summary')).toContainText('Ran', { timeout: 120_000 })
}

test('runs the Spanish noun-gender lesson in its own project', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(300_000)

  const projects = (await (await request.get(`${BACKEND_URL}/api/projects`)).json()) as {
    id: string
    name: string
  }[]
  const source = projects.find((project) => project.name === SOURCE_PROJECT)
  expect(source, `source project "${SOURCE_PROJECT}" exists`).toBeTruthy()
  const existingDemo = projects.find((project) => project.name === PROJECT_NAME)

  const assets = (await (await request.get(`${BACKEND_URL}/api/assets`)).json()) as {
    name: string
  }[]
  for (const name of [
    'blackboar-background',
    'female',
    'male',
    'paw with chalk',
    'paw with laser',
    'paw empty',
    'paw with rag',
    'writing-on-black-board',
    'dry-erase',
  ]) {
    expect(
      assets.some((asset) => asset.name === name),
      `asset "${name}" exists`,
    ).toBeTruthy()
  }
  const materials = (await (await request.get(`${BACKEND_URL}/api/materials`)).json()) as {
    id: string
    name: string
  }[]
  const chalk = materials.find((material) => material.name === 'Chalk')
  expect(chalk, 'the seeded Chalk material exists').toBeTruthy()

  // Clone the known blackboard project so the demo has its own editable project
  // and cannot overwrite the original scenario test.
  const original = JSON.parse(
    await (await request.get(`${BACKEND_URL}/api/projects/${source!.id}`)).text(),
  )
  original.project.id = existingDemo?.id ?? `project-spanish-gender-${Date.now()}`
  original.project.name = PROJECT_NAME
  original.slides[0].duration = SLIDE_DURATION
  // Keep the root, camera, and existing blackboard background from the
  // reference project. Remove its previous demo objects so they cannot cover
  // the new lesson; the backdrop itself is intentionally reused, not recreated.
  const scene = original.slides[0].scene
  const root = scene.nodes.find((node: { name: string }) => node.name === 'Root')
  const camera = scene.nodes.find((node: { name: string }) => node.name === 'Camera')
  const background = scene.nodes.find(
    (node: { name: string }) => node.name === 'blackboar-background',
  )
  expect(background, 'Scenario test already has the blackboard background node').toBeTruthy()
  background.transform = {
    ...background.transform,
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    scaleX: CANVAS_HEIGHT / BACKGROUND_IMAGE_HEIGHT,
    scaleY: CANVAS_HEIGHT / BACKGROUND_IMAGE_HEIGHT,
  }
  scene.nodes = [root, camera, background].filter(Boolean)
  if (original.library?.assets) {
    original.library.assets = original.library.assets.filter(
      (asset: { name: string }) => asset.name !== 'blackboard',
    )
  }
  original.slides[0].effects = []
  // The reference script has its own SFX at different times. Only keep sounds
  // authored by this lesson so old clips cannot trail the new visuals.
  original.slides[0].audio.clips = []
  delete original.slides[0].animationScript
  delete original.slides[0].animation
  const cloned = await request.post(`${BACKEND_URL}/api/projects`, {
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify(original),
  })
  expect(cloned.ok()).toBeTruthy()
  const clonedProject = (await cloned.json()) as { id: string }

  await page.goto('/')
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Projects' })
  await dialog.waitFor()
  await dialog
    .getByRole('listitem')
    .filter({ hasText: PROJECT_NAME })
    .first()
    .getByRole('button', { name: `Open ${PROJECT_NAME}` })
    .click()
  await dialog.waitFor({ state: 'hidden', timeout: 60_000 })
  await page.locator('.canvas-host canvas').waitFor()

  // Register the folders containing the background and the two picture assets
  // with the editor's asset library before Check resolves names in the script.
  await page.getByRole('complementary').getByRole('button', { name: 'Assets', exact: true }).click()
  for (const folder of ['Blackboard', 'lesson materials', 'Sounds']) {
    const rootFolder = page.getByRole('button', { name: 'Go to root folder' })
    if (await rootFolder.count()) await rootFolder.click()
    const folderButton = page.getByLabel(`Folder ${folder}`)
    if (await folderButton.count()) await folderButton.dblclick()
  }

  const createScript = page.getByTestId('bottom-tab-create-script')
  if (await createScript.count()) await createScript.click()
  else await page.getByTestId('bottom-tab-script').click()
  const sourceText = readFileSync(SCRIPT_PATH, 'utf8')
  expect(sourceText).not.toMatch(/\.fade(?:In|Out)\s*\(/)
  const effectsStart = sourceText.indexOf('// Each object starts hidden by its reveal mask')
  expect(effectsStart).toBeGreaterThan(0)
  // First establish renderer-measured title/table bounds, then check the effect
  // calls against that rendered scene. The final full run replaces the first.
  await checkAndRun(page, sourceText.slice(0, effectsStart))
  // Park on a populated-table frame so Check samples renderer-measured bounds
  // for every cell and text target.
  await page.getByTestId('bottom-tab-timeline').click()
  await page.getByRole('button', { name: 'Fit Timeline' }).click()
  await seek(page, 72)
  await page.getByTestId('bottom-tab-script').click()
  await checkAndRun(page, sourceText)

  await expect
    .poll(async () => {
      const stored = JSON.parse(
        await (await request.get(`${BACKEND_URL}/api/projects/${clonedProject.id}`)).text(),
      )
      const nodes = stored.slides[0].scene.nodes as {
        id: string
        name: string
        parentId?: string | null
        transform?: { scaleY?: number }
        components?: {
          assetInstance?: { assetDefinitionId?: string }
          text?: { content?: string }
        }
        material?: { definitionId?: string }
      }[]
      const byId = new Map(nodes.map((node) => [node.name, node]))
      const board = byId.get('Spanish lesson board')
      const tableId = byId.get('Gender examples table')?.id
      const effects = stored.slides[0].effects as {
        kind: string
        start: number
        nodeIds: string[]
      }[]
      const parentName = (name: string) => {
        const parentId = byId.get(name)?.parentId
        return nodes.find((node) => node.id === parentId)?.name
      }
      return {
        table: nodes.filter((node) => node.name === 'Gender examples table').length,
        background: nodes.filter((node) => node.name === 'blackboar-background').length,
        backgroundScale: nodes.find((node) => node.name === 'blackboar-background')?.transform
          .scaleY,
        easels: nodes.filter((node) => node.name === 'blackboard').length,
        images: ['female', 'male'].every((name) => nodes.some((node) => node.name === name)),
        tableUnderBoard: parentName('Gender examples table'),
        material: board?.material?.definitionId,
        effectCounts: Object.fromEntries(
          ['carry', 'mark', 'reveal', 'wipe'].map((kind) => [
            kind,
            stored.slides[0].effects.filter((effect: { kind: string }) => effect.kind === kind)
              .length,
          ]),
        ),
        carriedImages: stored.slides[0].effects.filter(
          (effect: { kind: string }) => effect.kind === 'carry',
        ).length,
        allEffectPawsScaled: stored.slides[0].effects.every(
          (effect: { visual?: { kind?: string; scale?: number } }) =>
            effect.visual?.kind === 'none' ||
            (effect.visual?.kind === 'asset' && effect.visual.scale === 4),
        ),
        femaleAsset: nodes.find((node) => node.name === 'female')?.components?.assetInstance
          ?.assetDefinitionId,
        maleAsset: nodes.find((node) => node.name === 'male')?.components?.assetInstance
          ?.assetDefinitionId,
        tableCellTextCount: nodes.filter((node) => node.components?.text?.content).length,
        emptyTableRevealIncludesFrame: effects.some(
          (effect) =>
            effect.kind === 'reveal' && effect.start === 52 && effect.nodeIds.includes(tableId!),
        ),
        tableWipeIncludesFrame: effects.some(
          (effect) =>
            effect.kind === 'wipe' && effect.start === 74.5 && effect.nodeIds.includes(tableId!),
        ),
        tableWipeTargetCount: Math.max(
          0,
          ...stored.slides[0].effects
            .filter((effect: { kind: string; nodeIds: string[] }) => effect.kind === 'wipe')
            .map((effect: { nodeIds: string[] }) => effect.nodeIds.length),
        ),
        audioClipCount: stored.slides[0].audio.clips.length,
        audioClipStarts: stored.slides[0].audio.clips
          .map((clip: { timelineStart: number }) => clip.timelineStart)
          .sort((a: number, b: number) => a - b),
        audioTracks: [
          ...new Set(stored.slides[0].audio.clips.map((clip: { trackId: string }) => clip.trackId)),
        ],
      }
    })
    .toEqual({
      table: 1,
      background: 1,
      easels: 0,
      images: true,
      tableUnderBoard: 'Spanish lesson board',
      material: chalk!.id,
      backgroundScale: CANVAS_HEIGHT / BACKGROUND_IMAGE_HEIGHT,
      effectCounts: { carry: 4, mark: 1, reveal: 22, wipe: 20 },
      carriedImages: 4,
      allEffectPawsScaled: true,
      femaleAsset: expect.any(String),
      maleAsset: expect.any(String),
      tableCellTextCount: 21,
      emptyTableRevealIncludesFrame: true,
      tableWipeIncludesFrame: true,
      tableWipeTargetCount: expect.any(Number),
      audioClipCount: EXPECTED_SOUND_STARTS.length,
      audioClipStarts: EXPECTED_SOUND_STARTS,
      audioTracks: ['sfx'],
    })
  await expect
    .poll(async () => {
      const stored = JSON.parse(
        await (await request.get(`${BACKEND_URL}/api/projects/${clonedProject.id}`)).text(),
      )
      return Math.max(
        0,
        ...stored.slides[0].effects
          .filter((effect: { kind: string; nodeIds: string[] }) => effect.kind === 'wipe')
          .map((effect: { nodeIds: string[] }) => effect.nodeIds.length),
      )
    })
    .toBeGreaterThan(10)

  // A Run owns its generated clips through animationScript.lastCompiled. A
  // repeat Run must replace those clips, not duplicate them or reintroduce
  // clips inherited from the reference project.
  await checkAndRun(page, sourceText)
  await expect
    .poll(async () => {
      const stored = JSON.parse(
        await (await request.get(`${BACKEND_URL}/api/projects/${clonedProject.id}`)).text(),
      )
      return {
        count: stored.slides[0].audio.clips.length,
        starts: stored.slides[0].audio.clips
          .map((clip: { timelineStart: number }) => clip.timelineStart)
          .sort((a: number, b: number) => a - b),
      }
    })
    .toEqual({ count: EXPECTED_SOUND_STARTS.length, starts: EXPECTED_SOUND_STARTS })

  // Save real renderer output at the story beats; compile/persistence checks
  // alone are not enough for this visual scenario.
  await page.getByTestId('bottom-tab-timeline').click()
  await page.getByRole('button', { name: 'Fit Timeline' }).click()
  const gridToggle = page.getByLabel('Grid', { exact: true })
  if (await gridToggle.isChecked()) await gridToggle.uncheck()
  const meshOverlay = page.getByLabel('Mesh', { exact: true })
  if (await meshOverlay.isChecked()) await meshOverlay.uncheck()
  const canvas = page.locator('.canvas-host canvas')
  for (const time of [2, 9, 13, 19, 27, 34, 44, 58, 68, 80]) {
    await seek(page, time)
    const screenshotPath = testInfo.outputPath(`spanish-gender-${time}s.png`)
    const screenshot = await canvas.screenshot({ path: screenshotPath })
    await testInfo.attach(`spanish-gender-${time}s`, {
      body: screenshot,
      contentType: 'image/png',
    })
  }
})
