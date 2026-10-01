import { mkdir, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

interface ProjectSummary {
  id: string
  name: string
  lastModified: string
}

interface LessonSummary {
  project: { name: string }
  slides: Array<{
    name: string
    duration: number
    scene: { nodes: Array<{ id: string }> }
    animation?: {
      nodes: Array<{
        tracks: Array<{ property: string; keyframes: unknown[] }>
      }>
    }
    audio?: { clips: unknown[] }
  }>
}

interface FrameSample {
  timestamp: number
  intervalMs: number
  activeRafs: number
}

interface ProbeCycle {
  label: string
  startAt: number
  playAt: number | null
  stopAt: number | null
  endAt: number | null
  frameSamples: FrameSample[]
  rafAtStart: number
  rafAtStop: number | null
  rafAfterSettle: number | null
  maxActiveRafs: number
  measurementRaf: number | null
}

interface LongTaskSample {
  startTime: number
  duration: number
}

interface PlaybackProbe {
  cycles: ProbeCycle[]
  longTasks: LongTaskSample[]
  activeRafs(): number
  begin(label: string): void
  markPlay(): void
  markStop(): void
  end(): void
}

type ProbeWindow = Window & { __playbackProbe?: PlaybackProbe }

interface BrowserMetrics {
  JSHeapUsedSize?: number
  TaskDuration?: number
  ScriptDuration?: number
  LayoutDuration?: number
  RecalcStyleDuration?: number
}

interface CpuProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number }
}

interface CpuProfile {
  nodes: CpuProfileNode[]
  samples?: number[]
  timeDeltas?: number[]
}

interface HeapProfileNode {
  callFrame: { functionName: string; url: string; lineNumber: number }
  selfSize: number
  children?: HeapProfileNode[]
}

interface HeapProfile {
  head: HeapProfileNode
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]
}

function secondsAt(text: string | null): number {
  const match = text?.match(/^(\d+):(\d+)\.(\d+)$/)
  if (!match) return 0
  return Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3]}`)
}

/**
 * Test-only response transform for the `PERF_SHADOWS=0` diagnostic. Strips
 * every node's `shadowEffect` from the in-memory project JSON before the app
 * sees it. The saved project on the backend is never modified.
 */
function stripShadowEffects(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripShadowEffects(item)
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  delete record.shadowEffect
  for (const child of Object.values(record)) stripShadowEffects(child)
}

function summarizeCpuProfile(profile: CpuProfile) {
  const nodesById = new Map(profile.nodes.map((node) => [node.id, node]))
  const selfTimeByFunction = new Map<string, { functionName: string; url: string; ms: number }>()
  for (const [index, nodeId] of (profile.samples ?? []).entries()) {
    const node = nodesById.get(nodeId)
    if (!node) continue
    const { functionName, url, lineNumber } = node.callFrame
    const key = `${functionName || '(anonymous)'}|${url}|${lineNumber}`
    const existing = selfTimeByFunction.get(key) ?? {
      functionName: functionName || '(anonymous)',
      url,
      ms: 0,
    }
    existing.ms += (profile.timeDeltas?.[index] ?? 0) / 1000
    selfTimeByFunction.set(key, existing)
  }
  return [...selfTimeByFunction.values()].sort((a, b) => b.ms - a.ms).slice(0, 25)
}

function summarizeHeapProfile(profile: HeapProfile) {
  const bytesByStack = new Map<string, { stack: string[]; bytes: number }>()
  const visit = (node: HeapProfileNode, parentStack: string[]): void => {
    const { functionName, url, lineNumber } = node.callFrame
    const frame = `${functionName || '(anonymous)'} @ ${url}:${lineNumber + 1}`
    const stack = [...parentStack, frame]
    const allocationStack = stack.slice(-8).reverse()
    const key = allocationStack.join('\n')
    const existing = bytesByStack.get(key) ?? {
      stack: allocationStack,
      bytes: 0,
    }
    existing.bytes += node.selfSize
    bytesByStack.set(key, existing)
    node.children?.forEach((child) => visit(child, stack))
  }
  visit(profile.head, [])
  return [...bytesByStack.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 25)
}

function summarizeCycle(
  cycle: ProbeCycle,
  longTasks: LongTaskSample[],
  metricsBefore: BrowserMetrics,
  metricsAfter: BrowserMetrics,
) {
  const playbackFrames = cycle.frameSamples.filter(
    (sample) =>
      cycle.playAt !== null &&
      cycle.stopAt !== null &&
      sample.timestamp >= cycle.playAt &&
      sample.timestamp <= cycle.stopAt,
  )
  const intervals = playbackFrames.map((sample) => sample.intervalMs)
  const cycleLongTasks = longTasks.filter(
    (task) => task.startTime >= cycle.playAt! && task.startTime < cycle.stopAt!,
  )
  const metricDelta = (key: keyof BrowserMetrics) => {
    const before = metricsBefore[key]
    const after = metricsAfter[key]
    return before === undefined || after === undefined ? null : after - before
  }

  return {
    label: cycle.label,
    frameCount: intervals.length,
    frameIntervalMs: {
      p50: percentile(intervals, 0.5),
      p95: percentile(intervals, 0.95),
      p99: percentile(intervals, 0.99),
      max: intervals.length === 0 ? 0 : Math.max(...intervals),
    },
    framesOver33ms: intervals.filter((interval) => interval > 33).length,
    framesOver50ms: intervals.filter((interval) => interval > 50).length,
    framesOver100ms: intervals.filter((interval) => interval > 100).length,
    longTasks: cycleLongTasks.map(({ startTime, duration }) => ({ startTime, duration })),
    rafCallbacks: {
      atStart: cycle.rafAtStart,
      atStop: cycle.rafAtStop,
      afterSettle: cycle.rafAfterSettle,
      maxDuringCycle: cycle.maxActiveRafs,
    },
    browserMetricsBefore: metricsBefore,
    browserMetricsAfter: metricsAfter,
    browserMetricsDelta: {
      taskDurationSeconds: metricDelta('TaskDuration'),
      scriptDurationSeconds: metricDelta('ScriptDuration'),
      layoutDurationSeconds: metricDelta('LayoutDuration'),
      recalcStyleDurationSeconds: metricDelta('RecalcStyleDuration'),
      heapBytes: metricDelta('JSHeapUsedSize'),
    },
  }
}

test('@perf repeated Play/Stop cycles record browser performance signals', async ({
  page,
  request,
}, testInfo) => {
  const projectId = process.env.PERF_PROJECT_ID
  test.skip(!projectId, 'Set PERF_PROJECT_ID to a saved project in the local backend.')

  const backendUrl = process.env.PERF_BACKEND_URL ?? 'http://localhost:8000'
  const summariesResponse = await request.get(`${backendUrl}/api/projects`)
  expect(summariesResponse.ok(), `Backend unavailable at ${backendUrl}`).toBe(true)
  const projects = (await summariesResponse.json()) as ProjectSummary[]
  const summary = projects.find((project) => project.id === projectId)
  expect(summary, `No saved project with id ${projectId}`).toBeDefined()

  const lessonResponse = await request.get(`${backendUrl}/api/projects/${projectId}`)
  expect(lessonResponse.ok(), `Could not load project ${projectId}`).toBe(true)
  const lesson = (await lessonResponse.json()) as LessonSummary
  const slide = lesson.slides[0]
  expect(slide, 'The selected project has no slides.').toBeDefined()

  const cyclesToRun = Number(process.env.PERF_CYCLES ?? 4)
  const stopAtSeconds = Number(
    process.env.PERF_STOP_AT_SECONDS ?? Math.min(8.5, slide.duration - 0.5),
  )
  const viewMode = process.env.PERF_VIEW_MODE === 'curveEditor' ? 'Curve Editor' : 'Dope Sheet'
  const meshOverlayVisible = process.env.PERF_MESH_VISIBLE !== '0'
  const shadowsEnabled = process.env.PERF_SHADOWS !== '0'
  expect(cyclesToRun).toBeGreaterThan(0)
  expect(stopAtSeconds).toBeGreaterThan(0)
  expect(stopAtSeconds).toBeLessThan(slide.duration)

  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.route(/^https?:\/\/[^/]+\/api\/.*$/, async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({
      url: new URL(`${url.pathname}${url.search}`, backendUrl).href,
    })
    const contentType = response.headers()['content-type'] ?? ''
    if (
      !shadowsEnabled &&
      route.request().method() === 'GET' &&
      contentType.includes('application/json')
    ) {
      const body = (await response.json()) as unknown
      stripShadowEffects(body)
      await route.fulfill({ response, json: body })
      return
    }
    await route.fulfill({ response })
  })
  await page.route(/^https?:\/\/[^/]+\/(?:health|ping)(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({
      url: new URL(`${url.pathname}${url.search}`, backendUrl).href,
    })
    await route.fulfill({ response })
  })

  await page.addInitScript(() => {
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window)
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window)
    const activeRafs = new Set<number>()
    const longTasks: LongTaskSample[] = []
    const cycles: ProbeCycle[] = []
    let current: ProbeCycle | null = null

    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      let id = 0
      id = nativeRequestAnimationFrame((timestamp) => {
        activeRafs.delete(id)
        callback(timestamp)
      })
      activeRafs.add(id)
      return id
    }
    window.cancelAnimationFrame = (id: number): void => {
      activeRafs.delete(id)
      nativeCancelAnimationFrame(id)
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ startTime: entry.startTime, duration: entry.duration })
        }
      }).observe({ entryTypes: ['longtask'] })
    } catch {
      // The frame-interval probe remains usable if Long Tasks are unsupported.
    }

    const probe: PlaybackProbe = {
      cycles,
      longTasks,
      activeRafs: () => activeRafs.size,
      begin: (label) => {
        if (current) throw new Error('A performance cycle is already active.')
        const cycle: ProbeCycle = {
          label,
          startAt: performance.now(),
          playAt: null,
          stopAt: null,
          endAt: null,
          frameSamples: [],
          rafAtStart: activeRafs.size,
          rafAtStop: null,
          rafAfterSettle: null,
          maxActiveRafs: activeRafs.size,
          measurementRaf: null,
        }
        cycles.push(cycle)
        current = cycle
        let previousTimestamp: number | null = null
        const sample = (timestamp: number): void => {
          if (current !== cycle) return
          if (previousTimestamp !== null) {
            cycle.frameSamples.push({
              timestamp,
              intervalMs: timestamp - previousTimestamp,
              activeRafs: activeRafs.size,
            })
          }
          previousTimestamp = timestamp
          cycle.maxActiveRafs = Math.max(cycle.maxActiveRafs, activeRafs.size)
          cycle.measurementRaf = nativeRequestAnimationFrame(sample)
        }
        cycle.measurementRaf = nativeRequestAnimationFrame(sample)
      },
      markPlay: () => {
        if (current) current.playAt = performance.now()
      },
      markStop: () => {
        if (current) {
          current.stopAt = performance.now()
          current.rafAtStop = activeRafs.size
        }
      },
      end: () => {
        if (!current) return
        current.endAt = performance.now()
        current.rafAfterSettle = activeRafs.size
        if (current.measurementRaf !== null) {
          nativeCancelAnimationFrame(current.measurementRaf)
        }
        current = null
      },
    }
    ;(window as ProbeWindow).__playbackProbe = probe
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click()
  await page.getByRole('dialog', { name: 'Projects' }).waitFor()
  await page.getByRole('button', { name: `Open ${summary!.name}` }).click()
  await expect(page.locator('.menu-bar__title')).toHaveText(summary!.name)
  await page.locator('.canvas-host canvas').waitFor()
  await page.getByLabel('Current time').waitFor()
  await page.getByRole('button', { name: viewMode, exact: true }).click()
  await expect(page.getByRole('button', { name: viewMode, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const meshToggle = page.getByRole('checkbox', { name: 'Mesh', exact: true })
  if ((await meshToggle.isChecked()) !== meshOverlayVisible) {
    if (meshOverlayVisible) await meshToggle.check()
    else await meshToggle.uncheck()
  }
  await page.waitForTimeout(2_000)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const captureCpuProfile = process.env.PERF_CPU_PROFILE === '1'
  const captureHeapProfile = process.env.PERF_HEAP_PROFILE === '1'
  const forceGcAfterRun = process.env.PERF_FORCE_GC_AFTER === '1'
  if (captureHeapProfile || forceGcAfterRun) await cdp.send('HeapProfiler.enable')
  if (captureCpuProfile) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
  }
  const getBrowserMetrics = async (): Promise<BrowserMetrics> => {
    const { metrics } = await cdp.send('Performance.getMetrics')
    const selected = new Set([
      'JSHeapUsedSize',
      'TaskDuration',
      'ScriptDuration',
      'LayoutDuration',
      'RecalcStyleDuration',
    ])
    return Object.fromEntries(
      metrics.filter(({ name }) => selected.has(name)).map(({ name, value }) => [name, value]),
    ) as BrowserMetrics
  }

  const idleRafCount = await page.evaluate(() =>
    (window as ProbeWindow).__playbackProbe!.activeRafs(),
  )
  await page.evaluate(() => (window as ProbeWindow).__playbackProbe!.begin('idle-baseline'))
  const idleMetricsBefore = await getBrowserMetrics()
  await page.evaluate(() => (window as ProbeWindow).__playbackProbe!.markPlay())
  await page.waitForTimeout(1_500)
  await page.evaluate(() => (window as ProbeWindow).__playbackProbe!.markStop())
  const idleMetricsAfter = await getBrowserMetrics()
  await page.evaluate(() => (window as ProbeWindow).__playbackProbe!.end())
  const metricPairs: Array<{ before: BrowserMetrics; after: BrowserMetrics }> = []
  const cpuProfiles: Array<{
    cycle: number
    topFunctions: ReturnType<typeof summarizeCpuProfile>
  }> = []
  const heapProfiles: Array<{
    cycle: number
    topAllocations: ReturnType<typeof summarizeHeapProfile>
  }> = []

  for (let cycleIndex = 0; cycleIndex < cyclesToRun; cycleIndex += 1) {
    await page.evaluate(
      (label) => (window as ProbeWindow).__playbackProbe!.begin(label),
      `cycle-${cycleIndex + 1}`,
    )
    const metricsBefore = await getBrowserMetrics()
    const profileThisCycle =
      (captureCpuProfile || captureHeapProfile) &&
      (cycleIndex === 0 || cycleIndex === cyclesToRun - 1)
    if (profileThisCycle && captureCpuProfile) await cdp.send('Profiler.start')
    if (profileThisCycle && captureHeapProfile) {
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32_768 })
    }

    await page.getByRole('button', { name: 'Play (timeline)' }).click()
    await page.evaluate(() => (window as ProbeWindow).__playbackProbe!.markPlay())
    await expect
      .poll(async () => secondsAt(await page.getByLabel('Current time').textContent()), {
        timeout: 20_000,
        intervals: [50, 100, 200],
      })
      .toBeGreaterThanOrEqual(stopAtSeconds)

    await page.getByRole('button', { name: 'Stop (timeline)' }).click()
    await page.evaluate(() => (window as ProbeWindow).__playbackProbe!.markStop())
    if (profileThisCycle && captureCpuProfile) {
      const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile }
      cpuProfiles.push({ cycle: cycleIndex + 1, topFunctions: summarizeCpuProfile(profile) })
    }
    if (profileThisCycle && captureHeapProfile) {
      const { profile } = (await cdp.send('HeapProfiler.stopSampling')) as { profile: HeapProfile }
      heapProfiles.push({ cycle: cycleIndex + 1, topAllocations: summarizeHeapProfile(profile) })
    }
    await page.waitForTimeout(250)
    const metricsAfter = await getBrowserMetrics()
    metricPairs.push({ before: metricsBefore, after: metricsAfter })
    await page.evaluate(() => (window as ProbeWindow).__playbackProbe!.end())
    await expect(page.getByLabel('Current time')).toHaveText('00:00.000')
  }

  const rawProbe = await page.evaluate(() => {
    const probe = (window as ProbeWindow).__playbackProbe!
    return { cycles: probe.cycles, longTasks: probe.longTasks }
  })
  const idleCycle = rawProbe.cycles[0]
  const cycleReports = rawProbe.cycles
    .slice(1)
    .map((cycle, index) =>
      summarizeCycle(
        cycle,
        rawProbe.longTasks,
        metricPairs[index].before,
        metricPairs[index].after,
      ),
    )
  const renderEnvironment = await page.evaluate(() => {
    const canvas = document.querySelector('.canvas-host canvas') as HTMLCanvasElement | null
    let renderer: string | null = null
    for (const contextName of ['webgl2', 'webgl'] as const) {
      const gl = canvas?.getContext(contextName) as
        WebGL2RenderingContext | WebGLRenderingContext | null
      if (!gl) continue
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      renderer = String(
        debugInfo
          ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
      )
      break
    }
    return {
      userAgent: navigator.userAgent,
      renderer,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })
  let browserMetricsAfterForcedGc: BrowserMetrics | null = null
  if (forceGcAfterRun) {
    await cdp.send('HeapProfiler.collectGarbage')
    browserMetricsAfterForcedGc = await getBrowserMetrics()
  }
  const maxP95DegradationMs = process.env.PERF_MAX_P95_DEGRADATION_MS
    ? Number(process.env.PERF_MAX_P95_DEGRADATION_MS)
    : null
  const report = {
    project: { id: projectId, name: lesson.project.name },
    slide: {
      name: slide.name,
      duration: slide.duration,
      nodes: slide.scene.nodes.length,
      rotationTracks:
        slide.animation?.nodes.reduce(
          (count, node) =>
            count + node.tracks.filter((track) => track.property === 'rotation').length,
          0,
        ) ?? 0,
      audioClips: slide.audio?.clips.length ?? 0,
    },
    run: {
      cycles: cyclesToRun,
      stopAtSeconds,
      viewMode,
      headless: process.env.PERF_HEADLESS !== '0',
      captureCpuProfile,
      captureHeapProfile,
      forceGcAfterRun,
      maxP95DegradationMs,
      meshOverlayVisible,
      shadowsEnabled,
      idleRafCount,
    },
    renderEnvironment,
    idleBaseline: summarizeCycle(
      idleCycle,
      rawProbe.longTasks,
      idleMetricsBefore,
      idleMetricsAfter,
    ),
    cycles: cycleReports,
    cpuProfiles,
    heapProfiles,
    browserMetricsAfterForcedGc,
    browserErrors,
  }

  const reportPath = testInfo.outputPath('playback-performance.json')
  await mkdir(testInfo.outputPath(), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  await testInfo.attach('playback-performance.json', {
    path: reportPath,
    contentType: 'application/json',
  })

  expect(browserErrors, 'Browser runtime errors occurred').toEqual([])
  expect(cycleReports.map((cycle) => cycle.rafCallbacks.afterSettle)).toEqual(
    Array.from({ length: cyclesToRun }, () => idleRafCount),
  )
  if (maxP95DegradationMs !== null && cycleReports.length > 1) {
    const degradation =
      cycleReports.at(-1)!.frameIntervalMs.p95 - cycleReports[0].frameIntervalMs.p95
    expect(
      degradation,
      `p95 frame interval degraded by ${degradation.toFixed(1)} ms across playback cycles`,
    ).toBeLessThanOrEqual(maxP95DegradationMs)
  }
})
