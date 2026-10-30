import { test, expect, type Route } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const BACKEND_URL = process.env.PERF_BACKEND_URL ?? 'http://localhost:8000'
const PROJECT_NAME = 'Ser Estar rule test'

test('captures the final exported frame from the authored camera', async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000)

  const projects = (await (await request.get(`${BACKEND_URL}/api/projects`)).json()) as {
    id: string
    name: string
  }[]
  const project = projects.find((entry) => entry.name === PROJECT_NAME)
  test.skip(!project, `local project ${PROJECT_NAME} is not available`)

  const lesson = await (await request.get(`${BACKEND_URL}/api/projects/${project!.id}`)).json()
  const slide = lesson.slides[0]
  const camera = slide.scene.nodes.find((node: { components?: { camera?: unknown } }) =>
    Boolean(node.components?.camera),
  )
  const cameraTracks = slide.animation.nodes.find(
    (entry: { nodeId: string }) => entry.nodeId === camera.id,
  )?.tracks
  expect(cameraTracks?.some((track: { keyframes: unknown[] }) => track.keyframes.length > 0)).toBe(
    true,
  )
  const expectedFrameCount = Math.round(slide.duration * 30)

  let capturedPng: Buffer | null = null
  let releaseFrameUpload!: () => void
  let frameUploadStarted!: () => void
  const finalFrameUploadStarted = new Promise<void>((resolve) => (frameUploadStarted = resolve))
  const allowUploadToFinish = new Promise<void>((resolve) => (releaseFrameUpload = resolve))

  await page.route('**/api/export/jobs**', async (route: Route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (method === 'GET' && url.pathname === '/api/export/jobs') {
      await route.fulfill({ json: [] })
      return
    }
    if (method === 'POST' && url.pathname === '/api/export/jobs') {
      await route.fulfill({
        json: {
          jobId: 'camera-frame-debug',
          status: 'queued',
          version: 1,
          settings: {},
          expectedFrameCount,
          totalDuration: slide.duration,
          totalFrames: expectedFrameCount,
          determinismKey: 'camera-frame-debug',
          concatMethod: 'concat demuxer',
          videoPixelFormat: 'yuv420p',
          videoMovflags: '+faststart',
          audioLoudnorm: 'loudnorm',
        },
      })
      return
    }
    if (method === 'POST' && url.pathname.endsWith('/frames')) {
      const body = route.request().postDataJSON() as {
        data: string
        frameIndex: number
        timestamp: number
      }
      if (body.frameIndex === expectedFrameCount - 1) {
        capturedPng = Buffer.from(body.data.replace(/^data:image\/png;base64,/, ''), 'base64')
        frameUploadStarted()
        await allowUploadToFinish
      }
      await route.fulfill({
        json: {
          jobId: 'camera-frame-debug',
          status: 'rendering',
          version: 1,
          settings: {},
          expectedFrameCount,
          totalDuration: slide.duration,
          totalFrames: expectedFrameCount,
          determinismKey: 'camera-frame-debug',
          concatMethod: 'concat demuxer',
          videoPixelFormat: 'yuv420p',
          videoMovflags: '+faststart',
          audioLoudnorm: 'loudnorm',
        },
      })
      return
    }
    if (url.pathname.endsWith('/cancel')) {
      await route.fulfill({ json: { jobId: 'camera-frame-debug', status: 'cancelled' } })
      return
    }
    await route.fulfill({ json: {} })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click()
  const projectsDialog = page.getByRole('dialog', { name: 'Projects' })
  await projectsDialog.waitFor()
  await page.getByRole('button', { name: `Open ${PROJECT_NAME}` }).click()
  await projectsDialog.waitFor({ state: 'hidden', timeout: 60_000 })
  await page.locator('.canvas-host canvas').waitFor()

  const canvas = page.locator('.canvas-host canvas')
  const canvasInfo = await canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement
    return {
      width: node.width,
      height: node.height,
    }
  })
  const cameraMode = page.getByRole('button', { name: 'Camera Animation Mode' })
  if (await cameraMode.count()) {
    await cameraMode.click()
    await page.waitForTimeout(100)
    const authoredCameraPng = await canvas.screenshot()
    writeFileSync(info.outputPath('editor-authored-camera-mode.png'), authoredCameraPng)
    await info.attach('editor-authored-camera-mode', {
      body: authoredCameraPng,
      contentType: 'image/png',
    })
    await cameraMode.click()
  }

  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Export video…' }).click()
  await page.getByTestId('export-video-dialog').waitFor()

  // Keep only the first slide selected so the captured PNG corresponds to the
  // same framing the user reported.
  for (const checkbox of await page.getByTestId(/^export-slide-checkbox-/).all()) {
    const id = await checkbox.getAttribute('data-testid')
    if (id !== `export-slide-checkbox-${slide.id}` && (await checkbox.isChecked())) {
      await checkbox.uncheck()
    }
  }
  await page.getByTestId('export-subtitles-toggle').uncheck()
  await page.getByTestId('export-start').click()
  await finalFrameUploadStarted

  // Pause the upload while the UI is still in the export phase, cancel cleanly,
  // then let the capture loop observe its cancellation flag.
  await page.getByTestId('export-cancel').click()
  releaseFrameUpload()
  await expect.poll(() => capturedPng?.byteLength ?? 0).toBeGreaterThan(100)
  const pngWidth = capturedPng!.readUInt32BE(16)
  const pngHeight = capturedPng!.readUInt32BE(20)
  expect({ width: pngWidth, height: pngHeight }).toEqual({
    width: canvasInfo.width,
    height: canvasInfo.height,
  })

  const pngPath = info.outputPath('ser-estar-slide-1-final-export-frame.png')
  writeFileSync(pngPath, capturedPng!)
  await info.attach('actual-final-export-frame', { path: pngPath, contentType: 'image/png' })
})
