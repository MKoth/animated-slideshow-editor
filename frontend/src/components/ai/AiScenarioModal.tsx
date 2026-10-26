import { useContext, useEffect, useMemo, useState } from 'react'
import { EngineContext } from '../../app/engineContext'
import {
  buildScenarioAvailableIds,
  buildScenarioChecklistRows,
  getScenarioHtmlState,
  getScenarioUnboundCount,
  isScenarioGenerateBlocked,
} from '../../engine/scenarioChecklist'
import {
  appendScenarioVersion,
  clearScenarioDocKeepHtml,
  createEmptyScenarioSection,
  createScenarioVersion,
  withScenarioHtml,
  withoutScenarioHtml,
} from '../../engine/scenarioSection'
import { buildScenarioImageFiles, renderScenarioChalkHtml } from '../../engine/scenarioChalkRender'
import { getScenarioTheme } from '../../engine/scenarioTheme'
import {
  buildScenarioPortablePack,
  encodeScenarioPortableZip,
} from '../../engine/scenarioPortableZip'
import { normalizeAssetKey, parseScenarioMarkdown } from '../../engine/scenarioMarkdown'
import { planScenarioDraft } from '../../ai/scenarioPlanner'
import { resolveForeignWords } from '../../ai/scenarioPromptSplit'
import {
  applyScenarioPrompter,
  snapshotScenarioScriptSlides,
  type ScenarioScriptApplyDispatcher,
} from '../../ai/scenarioScriptApply'
import { applyBoardReapply, planBoardReapply } from '../../ai/boardReapply'
import { runAnimationScript, runAnimationScriptAsync } from '../../engine/animationScriptRun'
import type { DispatchCommand } from '../../engine/commands/dispatcher'
import { captureAssetSnapshot, captureAudioSnapshot } from '../../app/assetSnapshot'
import { captureMaterialSnapshot, captureShaderSnapshot } from '../../app/definitionSnapshot'
import { ensureMaterialLibrariesLoaded } from '../../app/materialLibraries'
import { runScenarioTtsBatch } from '../../ai/scenarioTtsBatch'
import { collectGlobalAudioForRepair, repairSlideEffectSounds } from '../../ai/effectSoundRepair'
import { useTtsForeignVoiceStore } from '../../stores/ttsForeignVoiceStore'
import {
  buildScriptWorkflowFingerprint,
  useScenarioScriptWorkflowStore,
} from '../../stores/scenarioScriptWorkflowStore'
import { TtsApi } from '../../engine/ttsProvider'
import { apiClient } from '../../api'
import { TtsSettingsApi } from '../../api/ttsSettingsApi'
import { useAudioResizePreferenceStore } from '../../stores/audioResizePreferenceStore'
import type { ScenarioScriptPreview } from './AiScenarioScriptPanel'
import { AiScenarioScriptPanel } from './AiScenarioScriptPanel'
import { getPrompterSecondsPerCharacter, getPrompterSplitChars } from '../../engine/prompter'
import { imageBytesToDataUrl, resolveScenarioImageBytes } from '../../engine/scenarioImageBytes'
import { AiScenarioDocComments } from './AiScenarioDocComments'
import type { ScenarioDocComment } from '../../engine/scenarioDocComments'
import type { EnginePublic } from '../../engine/engine'
import { useAiStore } from '../../stores/aiStore'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { measuredNodeSize } from '../../pixi/renderer/nodeMeasurement'
import { useNotificationStore } from '../../stores/notificationStore'
import { AiScenarioChecklist } from './AiScenarioChecklist'
import { AiScenarioHistory } from './AiScenarioHistory'
import type { AiScenario, AiScenarioStep, ScenarioMarkdownVersion } from '../../api/aiApi'
import { ApiError } from '../../api/apiClient'
import type { AssetDefinition } from '../../api'

const EMPTY_MARKDOWN_VERSIONS: ScenarioMarkdownVersion[] = []

/**
 * Shared asset resolution maps: checklist binding ids resolve to filename
 * hints (Generate imageFiles), embedded snapshots, and library originals
 * (zip + preview byte resolution). One builder so Generate, Download, and
 * View never disagree about what a binding points at.
 */
function collectScenarioAssetMaps(
  embeddedAssets: ReadonlyArray<{ id: string; data: string; mimeType: string; name: string }>,
  allDefinitions: readonly AssetDefinition[],
  definitions: readonly AssetDefinition[],
): {
  byMeta: Map<string, { mime?: string; filenameHint?: string }>
  embeddedById: Map<string, { data: string; mimeType: string; name: string }>
  libraryById: Map<string, { mime?: string; filenameHint?: string; url?: string }>
} {
  const byMeta = new Map<string, { mime?: string; filenameHint?: string }>()
  const embeddedById = new Map<string, { data: string; mimeType: string; name: string }>()
  for (const asset of embeddedAssets) {
    byMeta.set(asset.id, { mime: asset.mimeType, filenameHint: asset.name })
    embeddedById.set(asset.id, { data: asset.data, mimeType: asset.mimeType, name: asset.name })
  }
  const libraryById = new Map<string, { mime?: string; filenameHint?: string; url?: string }>()
  for (const def of [...allDefinitions, ...definitions]) {
    if (!byMeta.has(def.id)) {
      byMeta.set(def.id, { mime: def.mimeType, filenameHint: def.original_filename })
    }
    if (!libraryById.has(def.id)) {
      libraryById.set(def.id, {
        mime: def.mimeType,
        filenameHint: def.original_filename,
        url: def.original_url,
      })
    }
  }
  return { byMeta, embeddedById, libraryById }
}

interface AiScenarioModalProps {
  projectId: string
  conversationId: string | null
  context?: unknown
}

/**
 * Re-run a rebuilt board source: the fast sync run first (everything is
 * embedded on a re-apply), falling back to the async run with library
 * capture when meshes or unembedded assets need preparation. Returns loud
 * failure instead of a silent no-op.
 */
async function runRebuiltBoardSource(
  engineValue: EnginePublic,
  dispatchRun: DispatchCommand,
  slideId: string,
  source: string,
): Promise<{ ran: boolean; error: string | null }> {
  const globals = collectGlobalAudioForRepair(useAssetLibraryStore.getState().allDefinitions)
  const syncResult = runAnimationScript(engineValue, dispatchRun, slideId, source, {
    measure: measuredNodeSize,
    globalAudioAssets: globals,
  })
  if (syncResult.ran) return { ran: true, error: null }
  await ensureMaterialLibrariesLoaded()
  const asyncResult = await runAnimationScriptAsync(engineValue, dispatchRun, slideId, source, {
    measure: measuredNodeSize,
    globalAudioAssets: globals,
    captureAsset: (definitionId) => captureAssetSnapshot(engineValue, definitionId),
    captureAudio: (assetId) => captureAudioSnapshot(engineValue, assetId),
    captureMaterial: (definitionId) => {
      if (!captureMaterialSnapshot(engineValue, definitionId)) return false
      const shaderId = engineValue.getMaterialDefinition(definitionId).shaderId
      return shaderId === null || captureShaderSnapshot(engineValue, shaderId)
    },
  })
  return { ran: asyncResult.ran, error: asyncResult.error }
}

/**
 * Doc-first scenario modal (issue #463, adopted Variant A).
 * Full doc center plus right-rail blocking checklist, top-bar Generate /
 * View / Download actions, Doc versus History versus Preview tabs.
 * Generate hard-blocked while any live-scanned row is unbound; View
 * explains itself before the first render; View plus zip enable once HTML
 * is ready with re-generation allowed and a stale hint after doc edits.
 * Deterministic chalk render (#464) wires into Generate — pure
 * client-side, no backend model call. Portable zip with manifest (#465)
 * shares the same bytes-required gate and resolves the same
 * embedded/library bytes through its own builder. Deletes are granular:
 * Delete doc clears doc + history and keeps HTML, Delete HTML drops only
 * the stored render and keeps the doc.
 */
export function AiScenarioModal({ projectId, conversationId, context }: AiScenarioModalProps) {
  const engineContextValue = useContext(EngineContext)
  const engine = engineContextValue?.engine
  const dispatcher = engineContextValue?.dispatcher
  const contextDispatch = engineContextValue?.dispatch
  const undoStack = engineContextValue?.undoStack
  const persistence = engineContextValue?.persistence
  const scenarioTab = useAiStore((s) => s.scenarioTab)
  const scenarios = useAiStore((s) => s.scenarios)
  const scenarioById = useAiStore((s) => s.scenarioById)
  const activeScenarioId = useAiStore((s) => s.activeScenarioId)
  const scenarioGenerating = useAiStore((s) => s.scenarioGenerating)
  const scenarioError = useAiStore((s) => s.scenarioError)
  const scenarioRequest = useAiStore((s) => s.scenarioRequest)
  const markdownBusy = useAiStore((s) => s.markdownBusy)
  const markdownVersions = useAiStore(
    (s) => s.markdownVersionsByProject[projectId] ?? EMPTY_MARKDOWN_VERSIONS,
  )
  const store = useAiStore.getState()
  const allDefinitions = useAssetLibraryStore((s) => s.allDefinitions)
  const definitions = useAssetLibraryStore((s) => s.definitions)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [scenarioRev, setScenarioRev] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  // Generate is async now: the narrator foreign-word list comes from the
  // same LLM backend, so the button shows a loader until it resolves.
  const [generatingHtml, setGeneratingHtml] = useState(false)
  const [confirmingDeleteDoc, setConfirmingDeleteDoc] = useState(false)
  const [confirmingDeleteHtml, setConfirmingDeleteHtml] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [copyMdState, setCopyMdState] = useState<'copied' | 'failed' | null>(null)
  // Accepted downstream snapshot backing Generate Script (issue #471): the
  // draft planner reads the accepted version only, never the active draft.
  const acceptedStoreId = useAiStore((s) => s.acceptedMarkdownVersionIdByProject[projectId] ?? null)
  // Inline doc comments live in the modal (survive Doc/History tab switches)
  // and clear once the doc itself changes to a new markdown version.
  const [docComments, setDocComments] = useState<ScenarioDocComment[]>([])
  // Reviewable script-draft preview (issue #471): the generated plan plus
  // per-step completion live in the persisted workflow store, so closing
  // and reopening the modal keeps the draft, the active buttons, and the
  // Regenerate states. Only in-flight progress/errors stay in memory.
  const storedWorkflow = useScenarioScriptWorkflowStore(
    (s) => s.workflowsByProject[projectId] ?? null,
  )
  // Step 1 (prompter) converges slides + prompter parts + durations;
  // per-step TTS synthesizes one step's blocks sequentially with the saved
  // TTS defaults; per-step board writes one animation source onto its
  // Step-1 slide. Steps 2 and 3 need Step 1 first, otherwise independent.
  const [scriptPrompterApplying, setScriptPrompterApplying] = useState(false)
  const [scriptPrompterError, setScriptPrompterError] = useState<string | null>(null)
  const [ttsApplyingPosition, setTtsApplyingPosition] = useState<number | null>(null)
  const [ttsProgressByStep, setTtsProgressByStep] = useState<
    Record<number, { done: number; total: number }>
  >({})
  const [ttsErrorByStep, setTtsErrorByStep] = useState<Record<number, string | null>>({})
  const [boardApplyingPosition, setBoardApplyingPosition] = useState<number | null>(null)
  const [boardErrorByStep, setBoardErrorByStep] = useState<Record<number, string | null>>({})
  const [soundRepairPosition, setSoundRepairPosition] = useState<number | null>(null)
  const [soundErrorByStep, setSoundErrorByStep] = useState<Record<number, string | null>>({})
  const [soundNoteByStep, setSoundNoteByStep] = useState<Record<number, string | null>>({})
  const [boardNoteByStep, setBoardNoteByStep] = useState<Record<number, string | null>>({})

  // Legacy Action Scenario data stays loadable for the in-modal editor and
  // Stage B reconciliation (which still reads the accepted scenario row).
  const activeScenario = activeScenarioId ? (scenarioById[activeScenarioId] ?? null) : null
  useEffect(() => {
    if (projectId) void store.loadScenarios(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])
  useEffect(() => {
    if (activeScenarioId) void store.loadScenario(activeScenarioId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScenarioId])

  // Scenario writes bypass the engine Undo Stack by design — signal
  // persistence explicitly or the change vanishes on reload.
  const persistScenario = () => persistence?.onCommandSucceeded()

  const handlePropose = () => {
    if (!projectId || !conversationId || !scenarioRequest.trim() || scenarioGenerating) return
    void store.proposeScenario(projectId, conversationId, scenarioRequest, context)
  }

  const handleRevise = () => {
    if (
      !projectId ||
      !conversationId ||
      !scenarioRequest.trim() ||
      !activeScenarioId ||
      scenarioGenerating
    )
      return
    void store.proposeScenario(
      projectId,
      conversationId,
      scenarioRequest,
      context,
      activeScenarioId,
    )
  }

  const scenario = engine?.project?.scenario
  const scenarioDocRev = useAiStore((s) => s.scenarioDocRevByProject[projectId] ?? 0)
  const markdown = scenario?.currentMarkdown ?? ''
  const bindings = scenario?.bindings ?? {}
  const lastHtml = scenario?.lastHtml
  const generatedFromVersionId = scenario?.generatedFromVersionId ?? null
  const portableVersions = useMemo(
    () => scenario?.versions ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario, scenarioRev, scenarioDocRev],
  )

  const embeddedIds = useMemo(
    () => (engine?.embeddedAssets ?? []).map((a) => a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine?.project?.id, (engine?.embeddedAssets ?? []).length],
  )
  const availableIds = useMemo(
    () => buildScenarioAvailableIds(embeddedIds, allDefinitions, definitions),
    [embeddedIds, allDefinitions, definitions],
  )

  const rows = useMemo(
    () => buildScenarioChecklistRows(markdown, bindings, availableIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markdown, bindings, availableIds, scenarioRev, scenarioDocRev],
  )
  const unboundCount = getScenarioUnboundCount(rows)
  // Hard block: brief text alone never unblocks, only resolved bytes do.
  const generateBlocked = isScenarioGenerateBlocked(rows)

  // Combined server + portable versions for freshness: the server list wins
  // when present, but portable Generate snapshots must also resolve so a
  // fresh render reads ready even before the next server sync.
  const versionsForState = useMemo(() => {
    const seen = new Set<string>()
    const combined: Array<{ id: string; content: string }> = []
    for (const v of [...markdownVersions, ...portableVersions]) {
      if (seen.has(v.id)) continue
      seen.add(v.id)
      combined.push(v)
    }
    return combined
  }, [markdownVersions, portableVersions])
  const htmlState = getScenarioHtmlState({
    lastHtml,
    currentMarkdown: markdown,
    generatedFromVersionId,
    versions: versionsForState,
  })

  const downloadBlocked = generateBlocked || htmlState === 'empty'
  const hasDoc = markdown !== '' || markdownVersions.length > 0

  const handleGenerate = async () => {
    const engineValue = engine
    if (!engineValue?.project || generateBlocked || generatingHtml) return
    setGeneratingHtml(true)
    try {
      const current = engineValue.project.scenario ?? createEmptyScenarioSection(markdown)
      const currentMarkdown = current.currentMarkdown ?? markdown

      // Resolve each bound key to a filename hint (mime + original name) so
      // render and the later zip builder share the slug mapping.
      const { byMeta } = collectScenarioAssetMaps(
        engineValue.embeddedAssets ?? [],
        allDefinitions,
        definitions,
      )
      const keys = rows.map((row) => row.key)
      const imageFiles = buildScenarioImageFiles(keys, (key) => {
        const binding = current.bindings[key]
        if (!binding) return undefined
        return byMeta.get(binding)
      })

      // Glue the narrator sentences into one text and ask the LLM (same
      // backend as every other assistant request) for the foreign
      // words/phrases in it. Best-effort: on any failure Generate still
      // completes, just without LLM highlights.
      let foreignWords: string[] = []
      try {
        const narrators = parseScenarioMarkdown(currentMarkdown)
          .steps.map((step) => step.narrator?.trim() ?? '')
          .filter((line) => line !== '')
        if (narrators.length > 0) {
          const detected = await store.api.detectForeignWords({
            projectId,
            ...(conversationId ? { conversationId } : {}),
            text: narrators.join('\n'),
          })
          foreignWords = detected.words ?? []
        }
      } catch (error) {
        // Best-effort: render without LLM highlights rather than failing Generate.
        // Prefer the backend's own reason (provider status/body) over the generic HTTP error.
        const message =
          error instanceof ApiError && error.detail
            ? error.detail
            : error instanceof Error
              ? error.message
              : 'Foreign-word detection failed.'
        useNotificationStore.getState().notify(`HTML highlights skipped: ${message}`)
      }

      const html = renderScenarioChalkHtml(currentMarkdown, { imageFiles, foreignWords })

      // Pointer must match content for ready: reuse the version whose content
      // equals the render source, else snapshot the current doc as a new
      // portable version so the fresh render reads ready.
      const match = [...markdownVersions, ...(current.versions ?? [])].find(
        (v) => v.content === currentMarkdown,
      )
      let next = current
      let pointer: string | null = match?.id ?? null
      if (!match) {
        let touched: number[] = []
        try {
          touched = parseScenarioMarkdown(currentMarkdown).steps.map((s) => s.index)
        } catch {
          touched = []
        }
        const snapshot = createScenarioVersion(currentMarkdown, 'Generate HTML snapshot', touched)
        next = appendScenarioVersion(next, snapshot)
        pointer = snapshot.id
      }
      engineValue.project.setScenario(withScenarioHtml(next, html, pointer, foreignWords))
      setScenarioRev((n) => n + 1)
      persistScenario()
    } finally {
      setGeneratingHtml(false)
    }
  }

  // Portable zip with manifest (issue #465). Separate builder from lesson
  // download, sharing only the embedded-asset guarantee: bytes resolve from
  // embedded snapshots first, then library original URLs. Same
  // bytes-required gate as Generate, so the zip never ships broken refs.
  const handleDownload = async () => {
    const engineValue = engine
    if (!engineValue?.project || downloadBlocked || downloading) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const current = engineValue.project.scenario ?? createEmptyScenarioSection(markdown)
      const currentMarkdown = current.currentMarkdown ?? markdown
      const { byMeta, embeddedById, libraryById } = collectScenarioAssetMaps(
        engineValue.embeddedAssets ?? [],
        allDefinitions,
        definitions,
      )
      const keys = rows.map((row) => row.key)
      const imageFiles = buildScenarioImageFiles(keys, (key) => {
        const binding = current.bindings[key]
        if (!binding) return undefined
        return byMeta.get(binding)
      })
      // Resolve bytes per key with periodic yields so large packs stay
      // responsive; any missing bytes abort instead of shipping broken refs.
      const imageBytes = await resolveScenarioImageBytes(
        keys,
        current.bindings,
        embeddedById,
        libraryById,
      )
      // Theme binaries (Crayon Libre + board tile) ship inside the zip.
      // Best-effort like the foreign-word list: on failure the pack falls
      // back to placeholder stubs rather than aborting the download.
      let themeFiles: Record<string, Uint8Array> | undefined
      try {
        themeFiles = (await getScenarioTheme()).files
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Theme assets failed to load.'
        useNotificationStore.getState().notify(`Theme assets skipped: ${message}`)
      }
      const pack = buildScenarioPortablePack({
        markdown: currentMarkdown,
        imageFiles,
        imageBytes,
        title: engineValue.project.name,
        foreignWords: current.foreignWords ?? [],
        themeFiles,
      })
      if (pack.sizeStatus === 'warn' && pack.sizeWarning) {
        useNotificationStore.getState().notify(pack.sizeWarning)
      }
      const zipped = encodeScenarioPortableZip(pack)
      // Separate from lesson download: its own blob + filename, no .lesson JSON.
      const blob = new Blob([zipped as unknown as BlobPart], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        const safeProject = (engineValue.project.name || 'scenario')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
        anchor.download = `${safeProject || 'scenario'}-blackboard.zip`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scenario zip download failed.'
      setDownloadError(message)
      useNotificationStore.getState().notify(message)
    } finally {
      setDownloading(false)
    }
  }

  // View builds preview HTML on demand: the stored render keeps portable
  // `assets/` paths (the zip context), but a `srcDoc` iframe inherits the
  // app origin where those paths 404 — so every image renders broken even
  // with all bytes bound. The preview re-renders with the same bytes
  // embedded as `data:` URIs. Stale opens the generating version's content
  // (the old render), matching the stale hint; missing versions fall back
  // to the current doc.
  const handleView = async () => {
    const engineValue = engine
    if (!engineValue?.project || htmlState === 'empty') return
    useAiStore.getState().setScenarioTab('preview')
    setPreviewOpen(true)
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewHtml(null)
    try {
      const current = engineValue.project.scenario ?? createEmptyScenarioSection(markdown)
      const pointer = current.generatedFromVersionId ?? null
      const versionContent = pointer
        ? versionsForState.find((v) => v.id === pointer)?.content
        : undefined
      const previewMarkdown = versionContent ?? current.currentMarkdown ?? markdown
      let previewKeys: string[] = []
      try {
        previewKeys = [
          ...new Set(
            parseScenarioMarkdown(previewMarkdown).steps.flatMap((s) =>
              s.visuals.map((v) => v.key),
            ),
          ),
        ]
      } catch {
        previewKeys = []
      }
      const { byMeta, embeddedById, libraryById } = collectScenarioAssetMaps(
        engineValue.embeddedAssets ?? [],
        allDefinitions,
        definitions,
      )
      const imageFiles = buildScenarioImageFiles(previewKeys, (key) => {
        const binding = current.bindings[key]
        if (!binding) return undefined
        return byMeta.get(binding)
      })
      const resolved = await resolveScenarioImageBytes(
        previewKeys,
        current.bindings,
        embeddedById,
        libraryById,
      )
      const dataUris: Record<string, string> = {}
      for (const key of previewKeys) {
        const file = imageFiles[key]
        const record = resolved[key]
        if (file && record) dataUris[file] = imageBytesToDataUrl(record.bytes, record.mime)
      }
      // Theme data URIs ride the same resolver (fonts + board tile embed as
      // `data:` so the srcDoc preview looks like the zip). Best-effort:
      // images still render when the theme fails to load.
      try {
        Object.assign(dataUris, (await getScenarioTheme()).dataUris)
      } catch {
        // Fall back to relative theme paths (solid board + system cursive).
      }
      setPreviewHtml(
        renderScenarioChalkHtml(previewMarkdown, {
          imageFiles,
          foreignWords: current.foreignWords ?? [],
          resolveAssetUrl: (file) => dataUris[file] ?? `assets/${file}`,
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scenario preview failed.'
      setPreviewError(message)
      useNotificationStore.getState().notify(message)
    } finally {
      setPreviewLoading(false)
    }
  }

  // Auto-load the preview when the Preview tab is active with stored HTML
  // but nothing loaded yet. Preview state is in-memory only, so after a
  // reload the tab would otherwise sit on "No preview loaded yet" until the
  // user clicks View HTML. The manual Load button stays as fallback/retry.
  useEffect(() => {
    if (scenarioTab !== 'preview') return
    if (htmlState === 'empty') return
    if (previewOpen || previewLoading || previewHtml || previewError) return
    // Intentionally state-driven (not event-driven): opening the tab IS the load trigger.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void handleView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioTab, htmlState, previewOpen, previewLoading, previewHtml, previewError])

  const handleClose = () => {
    setConfirmingDeleteDoc(false)
    setConfirmingDeleteHtml(false)
    setDeleteError(null)
    setCopyMdState(null)
    store.setScenarioModalOpen(false)
  }

  // Granular deletes (two-step arm + confirm each):
  // - Delete doc clears server versions plus the portable doc copy
  //   (markdown, versions, bindings) while keeping the stored HTML, so the
  //   orphaned Preview still renders the old content as stale.
  // - Delete HTML drops only the stored render + pointer (client-only, no
  //   server call) while keeping doc/history.
  // Plain project.setScenario — never through the engine Undo Stack.
  const handleDeleteDoc = () => {
    const engineValue = engine
    if (!engineValue?.project || markdownBusy) return
    if (!confirmingDeleteDoc) {
      setConfirmingDeleteDoc(true)
      setConfirmingDeleteHtml(false)
      setDeleteError(null)
      return
    }
    setConfirmingDeleteDoc(false)
    setDeleteError(null)
    const current = engineValue.project.scenario ?? createEmptyScenarioSection(markdown)
    const pointer = current.generatedFromVersionId ?? null
    void store.clearMarkdownVersions(projectId).then((ok) => {
      if (!ok || !engineValue.project) {
        setDeleteError(useAiStore.getState().markdownError?.message ?? 'Clear failed — retry.')
        return
      }
      engineValue.project.setScenario(clearScenarioDocKeepHtml(current, versionsForState, pointer))
      setDocComments([])
      setScenarioRev((n) => n + 1)
      persistScenario()
    })
  }

  const handleDeleteHtml = () => {
    const engineValue = engine
    if (!engineValue?.project || htmlState === 'empty') return
    if (!confirmingDeleteHtml) {
      setConfirmingDeleteHtml(true)
      setConfirmingDeleteDoc(false)
      setDeleteError(null)
      return
    }
    setConfirmingDeleteHtml(false)
    setDeleteError(null)
    const current = engineValue.project.scenario ?? createEmptyScenarioSection(markdown)
    engineValue.project.setScenario(withoutScenarioHtml(current))
    setPreviewOpen(false)
    setPreviewHtml(null)
    setPreviewError(null)
    setScenarioRev((n) => n + 1)
    persistScenario()
  }

  const handleCopyMd = () => {
    if (!markdown) return
    void (async () => {
      try {
        await navigator.clipboard.writeText(markdown)
        setCopyMdState('copied')
        window.setTimeout(() => setCopyMdState(null), 1800)
      } catch {
        setCopyMdState('failed')
        window.setTimeout(() => setCopyMdState(null), 2500)
      }
    })()
  }

  // Warnings-only validation surfaced in the Doc tab: the model drifts from
  // the script contract (missing title, unpaired actions), and one click
  // sends the list back as a fix request through the normal chat flow.
  const docWarnings = useMemo(
    () => (markdown ? parseScenarioMarkdown(markdown).warnings : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markdown, scenarioDocRev],
  )

  const handleSendWarnings = () => {
    if (!projectId || !conversationId || docWarnings.length === 0) return
    const lines = docWarnings.map(
      (w) => `- [${w.code}]${w.step ? ` step ${w.step}` : ''}: ${w.message}`,
    )
    void store.sendMessage(
      projectId,
      conversationId,
      `The scenario doc has these validation warnings — fix them all and reply with the corrected full markdown (same steps, corrected):\n${lines.join('\n')}\nDeclare intent: edit with Summary: and Touched-steps: lines as usual. Do not claim anything was created.`,
      context,
      'scenario',
    )
  }

  // Source gate (issue #471 + default-latest): the script draft reads the
  // accepted snapshot when one is pinned, otherwise the latest version as the
  // implicit default. Store pointer wins, portable section trails as fallback;
  // content must resolve in the combined server + portable versions. Once the
  // user pins a version it stays pinned — newer drafts never move it.
  const explicitAcceptedVersionId = acceptedStoreId ?? scenario?.acceptedVersionId ?? null
  const explicitAcceptedContent =
    explicitAcceptedVersionId !== null
      ? versionsForState.find((v) => v.id === explicitAcceptedVersionId)?.content
      : undefined
  const latestFallback =
    versionsForState.length > 0 ? versionsForState[versionsForState.length - 1] : undefined
  // Dangling explicit pins never fall back: a pinned id that no longer resolves
  // keeps blocking Generate and marks the preview stale instead of silently
  // switching source under the user.
  const isDefaultAccept = explicitAcceptedVersionId === null && latestFallback !== undefined
  const acceptedVersionId = explicitAcceptedVersionId ?? latestFallback?.id ?? null
  const acceptedContent =
    explicitAcceptedVersionId !== null ? explicitAcceptedContent : latestFallback?.content
  const hasAcceptedSnapshot = acceptedVersionId !== null && acceptedContent !== undefined

  // Live plan inputs: a stored workflow is only reused while these still
  // match (reading speed, split chars, bindings). An accepted-version change
  // keeps the preview and reads stale; changed inputs discard it.
  const liveFingerprint = buildScriptWorkflowFingerprint({
    secondsPerCharacter: engine?.project
      ? getPrompterSecondsPerCharacter(engine.project.settings)
      : 0.1,
    splitChars: engine?.project ? getPrompterSplitChars(engine.project.settings) : [],
    bindings: scenario?.bindings,
    html: scenario?.lastHtml,
    foreignWords: scenario?.foreignWords,
  })
  const activeWorkflow =
    storedWorkflow && storedWorkflow.fingerprint === liveFingerprint ? storedWorkflow : null
  const scriptPreview: ScenarioScriptPreview | null = activeWorkflow
    ? { acceptedVersionId: activeWorkflow.acceptedVersionId, plan: activeWorkflow.plan }
    : null
  const scriptStepsBusy =
    scriptPrompterApplying ||
    ttsApplyingPosition !== null ||
    boardApplyingPosition !== null ||
    soundRepairPosition !== null

  const handleGenerateScript = () => {
    const engineValue = engine
    if (!engineValue?.project || !hasAcceptedSnapshot || acceptedContent === undefined) return
    setScriptPrompterError(null)
    setTtsErrorByStep({})
    setTtsProgressByStep({})
    setBoardErrorByStep({})
    setSoundErrorByStep({})
    setSoundNoteByStep({})
    setBoardNoteByStep({})
    const secondsPerCharacter = getPrompterSecondsPerCharacter(engineValue.project.settings)
    const splitChars = getPrompterSplitChars(engineValue.project.settings)
    // Foreign vocabulary for block splitting comes from the stored chalk
    // HTML (`<strong class="foreign">`) with the stored list as fallback —
    // same highlights Generate HTML already rendered.
    const scenarioSection = engineValue.project.scenario
    // Bound library names win over raw md slugs in `create asset`: the
    // checklist binds each normalized scenario key to an asset id, so the
    // planner names the asset the user actually bound (e.g. "fox"), not the
    // md slug (e.g. "red-fox"). Embedded snapshots resolve first, matching
    // the Generate/Download asset maps.
    const assetNames: Record<string, string> = {}
    for (const embedded of engineValue.embeddedAssets ?? []) {
      if (assetNames[embedded.id] === undefined) assetNames[embedded.id] = embedded.name
    }
    for (const def of [...definitions, ...allDefinitions]) {
      if (assetNames[def.id] === undefined) assetNames[def.id] = def.name
    }
    const plan = planScenarioDraft(
      acceptedContent,
      secondsPerCharacter,
      snapshotScenarioScriptSlides(engineValue.project.slides),
      {
        splitChars,
        html: scenarioSection?.lastHtml,
        foreignWords: scenarioSection?.foreignWords,
        bindings: scenarioSection?.bindings,
        assetNames,
      },
    )
    // Same resolution the planner uses: HTML highlights + stored list.
    // Batch TTS speaks exact matches in the foreign language (Spanish).
    const resolvedForeignWords = resolveForeignWords(
      scenarioSection?.lastHtml,
      scenarioSection?.foreignWords,
    )
    useScenarioScriptWorkflowStore.getState().savePreview(projectId, {
      acceptedVersionId: acceptedVersionId!,
      fingerprint: buildScriptWorkflowFingerprint({
        secondsPerCharacter,
        splitChars,
        bindings: scenarioSection?.bindings,
        html: scenarioSection?.lastHtml,
        foreignWords: scenarioSection?.foreignWords,
      }),
      plan,
      foreignWords: resolvedForeignWords,
      prompterApplied: false,
      ttsDone: {},
      boardDone: {},
    })
    store.setScenarioTab('script')
  }

  const closeScriptPreview = () => {
    // Closing keeps the persisted workflow (draft + step states) so
    // reopening the modal resumes where the user left off.
    setScriptPrompterError(null)
    setTtsErrorByStep({})
    setBoardErrorByStep({})
    setSoundErrorByStep({})
    setBoardNoteByStep({})
    if (useAiStore.getState().scenarioTab === 'script') {
      store.setScenarioTab('doc')
    }
  }

  const getApplySystem = ():
    | { ok: false; error: string }
    | {
        ok: true
        engineValue: NonNullable<typeof engine>
        applyDispatcher: ScenarioScriptApplyDispatcher
      } => {
    const engineValue = engine
    if (!engineValue?.project || !scriptPreview) return { ok: false, error: 'No preview.' }
    const applyDispatcher = dispatcher
      ? { dispatch: dispatcher.dispatch.bind(dispatcher) }
      : contextDispatch && undoStack
        ? { dispatch: contextDispatch }
        : null
    if (!applyDispatcher || !undoStack) {
      return { ok: false, error: 'Apply unavailable — no command dispatcher in this host.' }
    }
    return { ok: true, engineValue, applyDispatcher }
  }

  const handleApplyPrompter = () => {
    if (!scriptPreview || !activeWorkflow || scriptStepsBusy) return
    const system = getApplySystem()
    if (!system.ok) {
      if (system.error !== 'No preview.') setScriptPrompterError(system.error)
      return
    }
    const { engineValue, applyDispatcher } = system
    setScriptPrompterApplying(true)
    setScriptPrompterError(null)
    try {
      const result = applyScenarioPrompter(
        { dispatcher: applyDispatcher, undoStack: undoStack! },
        {
          plan: scriptPreview.plan,
          existingSlides: snapshotScenarioScriptSlides(engineValue.project!.slides),
        },
      )
      if (!result.ok) {
        setScriptPrompterError(result.error ?? 'Apply failed.')
        useNotificationStore.getState().notify(result.error ?? 'Apply failed.')
        return
      }
      // A prompter re-apply drops TTS audio and invalidates prior board/TTS
      // work against the old parts — the store clears per-step states.
      useScenarioScriptWorkflowStore.getState().markPrompterApplied(projectId)
      const done = `Applied prompter text: ${result.targetSlideIds.length} slide(s) — one undo step.`
      useNotificationStore.getState().notify(done)
    } finally {
      setScriptPrompterApplying(false)
    }
  }

  const handleGenerateTtsStep = (position: number) => {
    if (!scriptPreview || !activeWorkflow || scriptStepsBusy) return
    const system = getApplySystem()
    if (!system.ok) {
      if (system.error !== 'No preview.') {
        setTtsErrorByStep((prev) => ({ ...prev, [position]: system.error }))
      }
      return
    }
    const { engineValue, applyDispatcher } = system
    const project = engineValue.project!
    if (project.slides.length < position) {
      const message = `Step 1 has not been applied for step ${position} — apply prompter text first.`
      setTtsErrorByStep((prev) => ({ ...prev, [position]: message }))
      useNotificationStore.getState().notify(message)
      return
    }
    const snapshot = {
      slides: project.slides.map((s) => ({
        id: s.id,
        prompter: s.prompter
          ? {
              parts: s.prompter.parts.map((p) => ({
                id: p.id,
                text: p.text,
                duration: p.duration,
                startTime: p.startTime,
              })),
            }
          : null,
      })),
      settings: project.settings,
    }
    setTtsApplyingPosition(position)
    setTtsErrorByStep((prev) => ({ ...prev, [position]: null }))
    setTtsProgressByStep((prev) => ({ ...prev, [position]: { done: 0, total: 0 } }))
    void (async () => {
      try {
        // Saved TTS defaults (no per-block dialogs in batch): model/provider
        // from the backend settings, mismatch handling from the saved voice
        // preference (ask falls back to stretch so batch never blocks).
        let modelId: string | undefined
        let provider: string | undefined
        try {
          const api = new TtsSettingsApi(apiClient)
          const models = await api.getModels()
          modelId =
            (models.defaultModel as string) || (models.default_model_id as string) || undefined
          provider =
            (models.defaultProvider as string) || (models.default_provider as string) || undefined
        } catch {
          // Fall back to engine defaults when settings are unreachable.
        }
        const savedPref = useAudioResizePreferenceStore.getState().getPreference('voice')
        const mode = savedPref ?? 'stretch'
        const foreignVoice = useTtsForeignVoiceStore.getState()
        const tts = new TtsApi(apiClient)
        const result = await runScenarioTtsBatch(
          { dispatcher: applyDispatcher, undoStack: undoStack! },
          snapshot,
          tts,
          {
            ...(modelId ? { modelId } : {}),
            ...(provider ? { provider } : {}),
            mode,
            positions: [position],
            foreignWords: activeWorkflow.foreignWords,
            ...(foreignVoice.referenceAssetId
              ? {
                  foreignReferenceAssetId: foreignVoice.referenceAssetId,
                  ...(foreignVoice.referenceTranscript.trim() !== ''
                    ? { foreignRefText: foreignVoice.referenceTranscript.trim() }
                    : {}),
                }
              : {}),
            onProgress: (done, total) =>
              setTtsProgressByStep((prev) => ({ ...prev, [position]: { done, total } })),
          },
        )
        if (!result.ok) {
          setTtsErrorByStep((prev) => ({ ...prev, [position]: result.error }))
          useNotificationStore.getState().notify(result.error)
          setTtsProgressByStep((prev) => {
            const next = { ...prev }
            delete next[position]
            return next
          })
          return
        }
        useScenarioScriptWorkflowStore.getState().markTtsDone(projectId, position)
        const foreignVoiceUsed =
          result.foreignCount > 0 && foreignVoice.referenceAssetId ? ' with Spanish voice' : ''
        const done =
          `Generated TTS for step ${position} (${result.count} block(s)` +
          (result.foreignCount > 0
            ? `, ${result.foreignCount} in Spanish${foreignVoiceUsed}`
            : '') +
          `)` +
          (savedPref ? '' : ' (no saved mismatch default — used stretch)') +
          ' — one undo step.'
        useNotificationStore.getState().notify(done)
      } finally {
        setTtsApplyingPosition(null)
      }
    })()
  }

  const handleApplyBoardStep = (position: number) => {
    if (!scriptPreview || !activeWorkflow || scriptStepsBusy) return
    const system = getApplySystem()
    if (!system.ok) {
      if (system.error !== 'No preview.') {
        setBoardErrorByStep((prev) => ({ ...prev, [position]: system.error }))
      }
      return
    }
    const { engineValue, applyDispatcher } = system
    const project = engineValue.project!
    const planSlide = scriptPreview.plan.slides[position - 1]
    if (!planSlide) {
      const message = `No step ${position} in this draft — nothing executed.`
      setBoardErrorByStep((prev) => ({ ...prev, [position]: message }))
      useNotificationStore.getState().notify(message)
      return
    }
    const slide = project.slides[position - 1]
    if (!slide) {
      const message = `Step 1 has not been applied for step ${position} — apply prompter text first.`
      setBoardErrorByStep((prev) => ({ ...prev, [position]: message }))
      useNotificationStore.getState().notify(message)
      return
    }
    const liveParts = slide.prompter?.parts ?? []
    if (liveParts.length === 0) {
      const message = `Step ${position} has no prompter parts — apply prompter text first.`
      setBoardErrorByStep((prev) => ({ ...prev, [position]: message }))
      useNotificationStore.getState().notify(message)
      return
    }
    if (acceptedContent === undefined) {
      const message = 'No accepted scenario content — re-generate script first.'
      setBoardErrorByStep((prev) => ({ ...prev, [position]: message }))
      useNotificationStore.getState().notify(message)
      return
    }
    setBoardApplyingPosition(position)
    setBoardErrorByStep((prev) => ({ ...prev, [position]: null }))
    setBoardNoteByStep((prev) => ({ ...prev, [position]: null }))
    void (async () => {
      try {
        // Reconstruct from the situation as it is NOW: re-parse the accepted
        // doc for this step's actions and re-lay the board onto the live
        // prompter windows (actual TTS lengths), not the stale estimates.
        const parsedStep = parseScenarioMarkdown(acceptedContent).steps.find(
          (entry) => entry.index === planSlide.stepIndex,
        )
        if (!parsedStep) {
          const message = `Step ${planSlide.stepIndex} changed since Generate — re-generate script first.`
          setBoardErrorByStep((prev) => ({ ...prev, [position]: message }))
          useNotificationStore.getState().notify(message)
          return
        }
        const scenarioSection = engineValue.project!.scenario
        const assetNames: Record<string, string> = {}
        for (const embedded of engineValue.embeddedAssets ?? []) {
          if (assetNames[embedded.id] === undefined) assetNames[embedded.id] = embedded.name
        }
        for (const def of [...definitions, ...allDefinitions]) {
          if (assetNames[def.id] === undefined) assetNames[def.id] = def.name
        }
        const assetNameForPlaced = (slug: string): string => {
          const boundId = scenarioSection?.bindings?.[normalizeAssetKey(slug)]
          if (boundId !== undefined) {
            const name = assetNames[boundId]
            if (name !== undefined && name !== '') return name
          }
          return slug
        }
        const previousLength = slide.duration
        const planned = planBoardReapply({
          planSlide,
          step: parsedStep,
          liveParts: liveParts.map((part) => ({
            duration: part.duration,
            startTime: part.startTime,
            endTime: part.endTime,
          })),
          assetNameForPlaced,
          ...(scenarioSection?.lastHtml !== undefined ? { html: scenarioSection.lastHtml } : {}),
        })
        if (!planned.ok) {
          setBoardErrorByStep((prev) => ({ ...prev, [position]: planned.error }))
          useNotificationStore.getState().notify(planned.error)
          return
        }
        const applied = await applyBoardReapply(
          { dispatcher: applyDispatcher, undoStack: undoStack! },
          engineValue,
          slide.id,
          planned.plan,
          (id, source) =>
            runRebuiltBoardSource(
              engineValue,
              (command) => applyDispatcher.dispatch(command),
              id,
              source,
            ),
        )
        if (!applied.ok) {
          setBoardErrorByStep((prev) => ({ ...prev, [position]: applied.error }))
          useNotificationStore.getState().notify(applied.error)
          return
        }
        // Keep the Preview tab truthful: the stored draft now carries the
        // rebuilt source, fractions and total.
        useScenarioScriptWorkflowStore.getState().savePreview(projectId, {
          ...activeWorkflow,
          plan: {
            ...activeWorkflow.plan,
            slides: activeWorkflow.plan.slides.map((entry, index) =>
              index === position - 1
                ? {
                    ...entry,
                    source: planned.plan.source,
                    fractions: [...planned.plan.fractions],
                    duration: planned.plan.slideDuration,
                    boardCost: planned.plan.boardCost,
                    padded: planned.plan.padded,
                  }
                : entry,
            ),
          },
        })
        useScenarioScriptWorkflowStore.getState().markBoardDone(projectId, position)
        const fmt = (value: number) => `${value.toFixed(2)}s`
        const extras = [
          ...(planned.plan.padded ? ['board outruns the voice — padded'] : []),
          ...(planned.plan.gapsCollapsed
            ? ['prompter gaps are not preserved in board timing']
            : []),
        ]
        const writeNote =
          `Step ${position}: board rebuilt from live prompts (${fmt(planned.plan.livePromptsEnd)} + 1s tail) — ` +
          `length ${fmt(previousLength)} → ${fmt(planned.plan.slideDuration)}` +
          (extras.length > 0 ? ` (${extras.join('; ')})` : '')
        if (!applied.runRan) {
          const message =
            `${writeNote}. Source and length applied, but the re-run failed: ${applied.runError} ` +
            `Open the Script panel and press Run.`
          setBoardNoteByStep((prev) => ({ ...prev, [position]: writeNote + '.' }))
          setBoardErrorByStep((prev) => ({ ...prev, [position]: message }))
          useNotificationStore.getState().notify(message)
          return
        }
        const done = `${writeNote}, re-run ok. Two undo steps.`
        setBoardNoteByStep((prev) => ({ ...prev, [position]: done }))
        useNotificationStore.getState().notify(done)
      } finally {
        setBoardApplyingPosition(null)
      }
    })()
  }

  const handleRepairSoundsStep = (position: number) => {
    if (!scriptPreview || !activeWorkflow || scriptStepsBusy) return
    const system = getApplySystem()
    if (!system.ok) {
      if (system.error !== 'No preview.') {
        setSoundErrorByStep((prev) => ({ ...prev, [position]: system.error }))
      }
      return
    }
    const { engineValue, applyDispatcher } = system
    const project = engineValue.project!
    const slide = project.slides[position - 1]
    if (!slide) {
      const message = `Step 1 has not been applied for step ${position} — apply prompter text first.`
      setSoundErrorByStep((prev) => ({ ...prev, [position]: message }))
      useNotificationStore.getState().notify(message)
      return
    }
    setSoundRepairPosition(position)
    setSoundErrorByStep((prev) => ({ ...prev, [position]: null }))
    setSoundNoteByStep((prev) => ({ ...prev, [position]: null }))
    try {
      // Repair compiles the slide's live board source: connected effect
      // sounds are deleted and re-placed at the visual times, everything
      // else is preserved. A board script that no longer compiles reports
      // its errors here instead of silently doing nothing.
      const globals = collectGlobalAudioForRepair(useAssetLibraryStore.getState().allDefinitions)
      const result = repairSlideEffectSounds(
        { dispatcher: applyDispatcher, undoStack: undoStack! },
        engineValue,
        slide.id,
        { measure: measuredNodeSize, globalAudioAssets: globals },
      )
      if (!result.ok) {
        setSoundErrorByStep((prev) => ({ ...prev, [position]: result.error }))
        useNotificationStore.getState().notify(result.error)
        return
      }
      const done = result.noop
        ? `Step ${position}: effect sounds already in place — nothing to do.`
        : `Step ${position}: repaired effect sounds (removed ${result.deleted}, placed ${result.created}) — voice and manual audio untouched, one undo step.`
      setSoundNoteByStep((prev) => ({ ...prev, [position]: done }))
      useNotificationStore.getState().notify(done)
    } finally {
      setSoundRepairPosition(null)
    }
  }

  return (
    <div
      data-testid="ai-scenario-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Scenario"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') handleClose()
        }}
        style={{
          background: 'var(--color-bg-panel)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          maxWidth: 960,
          width: 'calc(100% - 48px)',
          maxHeight: 'calc(100% - 48px)',
          overflow: 'auto',
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <strong>Scenario</strong>
          <button
            data-testid="ai-scenario-generate"
            disabled={generateBlocked || generatingHtml}
            title={
              generatingHtml
                ? 'Detecting foreign words and rendering HTML…'
                : generateBlocked
                  ? `Blocked — ${unboundCount} unbound`
                  : 'Generate HTML'
            }
            onClick={() => void handleGenerate()}
          >
            {generatingHtml
              ? 'Generating HTML…'
              : generateBlocked
                ? `Generate HTML (blocked — ${unboundCount} unbound)`
                : 'Generate HTML'}
          </button>
          <button
            data-testid="ai-scenario-view"
            disabled={htmlState === 'empty'}
            title={htmlState === 'empty' ? 'No HTML yet — generate first' : 'View stored HTML'}
            onClick={() => {
              if (htmlState !== 'empty') void handleView()
            }}
          >
            View HTML
          </button>
          <button
            data-testid="ai-scenario-download"
            disabled={downloadBlocked || downloading}
            title={
              downloadBlocked
                ? generateBlocked
                  ? `Blocked — ${unboundCount} unbound`
                  : 'No HTML yet — generate first'
                : 'Download zip'
            }
            onClick={() => void handleDownload()}
          >
            {downloading ? 'Preparing zip…' : 'Download .zip'}
          </button>
          <button
            data-testid="ai-scenario-delete-doc"
            disabled={markdownBusy || !hasDoc}
            title={
              confirmingDeleteDoc
                ? 'Click again to permanently delete the doc and history (HTML preview is kept)'
                : 'Delete doc and history (keeps HTML)'
            }
            onClick={handleDeleteDoc}
          >
            {confirmingDeleteDoc ? 'Confirm delete doc?' : 'Delete doc'}
          </button>
          <button
            data-testid="ai-scenario-delete-html"
            disabled={htmlState === 'empty'}
            title={
              confirmingDeleteHtml
                ? 'Click again to permanently delete the stored HTML (doc is kept)'
                : 'Delete stored HTML (keeps doc)'
            }
            onClick={handleDeleteHtml}
          >
            {confirmingDeleteHtml ? 'Confirm delete HTML?' : 'Delete HTML'}
          </button>
          <button
            data-testid="ai-scenario-copy-md"
            disabled={!markdown}
            aria-label={
              copyMdState === 'copied'
                ? 'Scenario markdown copied'
                : copyMdState === 'failed'
                  ? 'Copy scenario markdown failed'
                  : 'Copy scenario markdown'
            }
            title={
              copyMdState === 'copied'
                ? 'Copied'
                : copyMdState === 'failed'
                  ? 'Copy failed'
                  : 'Copy markdown'
            }
            onClick={handleCopyMd}
          >
            {copyMdState === 'copied'
              ? 'Copied'
              : copyMdState === 'failed'
                ? 'Copy failed'
                : 'Copy MD'}
          </button>
          <button
            data-testid="ai-scenario-generate-script"
            disabled={!hasAcceptedSnapshot}
            title={
              hasAcceptedSnapshot
                ? isDefaultAccept
                  ? 'Draft slides, prompter parts, and board scripts from the latest version (default — nothing accepted yet)'
                  : 'Draft slides, prompter parts, and board scripts from the accepted snapshot'
                : 'No versions yet — chat to iterate, then Generate Script reads the latest version by default'
            }
            onClick={handleGenerateScript}
          >
            {scriptPreview ? 'Regenerate Script' : 'Generate Script'}
          </button>
          <button data-testid="ai-scenario-modal-close" onClick={handleClose}>
            Close
          </button>
        </div>

        <div data-testid="ai-scenario-unbound-count">
          {generateBlocked ? `${unboundCount} unbound` : 'All visuals bound'}
        </div>
        <div data-testid="ai-scenario-html-state">html: {htmlState}</div>
        {downloadError && <div data-testid="ai-scenario-download-error">{downloadError}</div>}
        {deleteError && <div data-testid="ai-scenario-delete-error">{deleteError}</div>}
        {htmlState === 'empty' && (
          <div data-testid="ai-scenario-view-empty-hint">No HTML yet — generate first.</div>
        )}
        {htmlState === 'stale' && (
          <div data-testid="ai-scenario-stale-hint">
            Stale — doc edited after generation, View shows the old render.
          </div>
        )}
        {!hasAcceptedSnapshot && (
          <div data-testid="ai-scenario-script-accept-hint">
            No versions yet — chat to iterate. Generate Script reads the latest version by default
            once one exists.
          </div>
        )}
        {hasAcceptedSnapshot && isDefaultAccept && (
          <div data-testid="ai-scenario-script-default-hint">
            Using latest version {acceptedVersionId!.slice(0, 8)} as default — nothing accepted yet.
            Generate Script reads the latest version until you pin one.
            <button
              data-testid="ai-scenario-script-open-history"
              onClick={() => store.setScenarioTab('history')}
            >
              Open History
            </button>
          </div>
        )}
        <div data-testid="ai-scenario-modal-tabs">
          <button
            data-testid="ai-scenario-modal-tab-doc"
            disabled={scenarioTab === 'doc'}
            onClick={() => store.setScenarioTab('doc')}
          >
            Doc
          </button>
          <button
            data-testid="ai-scenario-modal-tab-history"
            disabled={scenarioTab === 'history'}
            onClick={() => store.setScenarioTab('history')}
          >
            History
          </button>
          <button
            data-testid="ai-scenario-modal-tab-preview"
            disabled={scenarioTab === 'preview'}
            onClick={() => store.setScenarioTab('preview')}
          >
            Preview
          </button>
          <button
            data-testid="ai-scenario-modal-tab-script"
            disabled={scenarioTab === 'script' || !scriptPreview}
            title={scriptPreview ? 'Review the generated script draft' : 'Generate Script first'}
            onClick={() => {
              if (scriptPreview) store.setScenarioTab('script')
            }}
          >
            Script
          </button>
        </div>

        {scenarioTab === 'history' ? (
          <AiScenarioHistory projectId={projectId} conversationId={conversationId} />
        ) : scenarioTab === 'script' ? (
          <div
            data-testid="ai-scenario-modal-script-body"
            style={{ marginTop: 8, maxHeight: '60vh', overflow: 'auto' }}
          >
            {scriptPreview && activeWorkflow ? (
              <AiScenarioScriptPanel
                preview={scriptPreview}
                currentAcceptedVersionId={acceptedVersionId}
                prompterApplying={scriptPrompterApplying}
                prompterError={scriptPrompterError}
                prompterApplied={activeWorkflow.prompterApplied}
                onApplyPrompter={handleApplyPrompter}
                steps={scriptPreview.plan.slides.map((slide) => ({
                  position: slide.position,
                  slideName: slide.slideName,
                  ttsStatus:
                    ttsApplyingPosition === slide.position
                      ? 'applying'
                      : activeWorkflow.ttsDone[slide.position]
                        ? 'done'
                        : 'idle',
                  ttsProgress: ttsProgressByStep[slide.position] ?? null,
                  ttsError: ttsErrorByStep[slide.position] ?? null,
                  boardStatus:
                    boardApplyingPosition === slide.position
                      ? 'applying'
                      : activeWorkflow.boardDone[slide.position]
                        ? 'done'
                        : 'idle',
                  boardError: boardErrorByStep[slide.position] ?? null,
                  boardNote: boardNoteByStep[slide.position] ?? null,
                  soundStatus: soundRepairPosition === slide.position ? 'applying' : 'idle',
                  soundError: soundErrorByStep[slide.position] ?? null,
                  soundNote: soundNoteByStep[slide.position] ?? null,
                }))}
                onGenerateTtsStep={handleGenerateTtsStep}
                onApplyBoardStep={handleApplyBoardStep}
                onRepairSoundsStep={handleRepairSoundsStep}
                onClose={closeScriptPreview}
              />
            ) : (
              <div data-testid="ai-scenario-script-empty">
                No script draft yet — click Generate Script.
              </div>
            )}
          </div>
        ) : scenarioTab === 'preview' ? (
          <div data-testid="ai-scenario-modal-preview-body" style={{ marginTop: 8 }}>
            {htmlState === 'empty' ? (
              <div data-testid="ai-scenario-preview-empty">No HTML yet — generate first.</div>
            ) : !previewOpen && !previewLoading && !previewHtml && !previewError ? (
              <div data-testid="ai-scenario-html-preview">
                <div>No preview loaded yet.</div>
                <button
                  data-testid="ai-scenario-html-preview-load"
                  onClick={() => {
                    void handleView()
                  }}
                >
                  Load preview
                </button>
              </div>
            ) : (
              <div data-testid="ai-scenario-html-preview">
                <div>Preview (stored HTML{htmlState === 'stale' ? ' — stale' : ''})</div>
                {previewLoading && (
                  <div data-testid="ai-scenario-html-preview-loading">Resolving images…</div>
                )}
                {previewError && (
                  <div data-testid="ai-scenario-html-preview-error">{previewError}</div>
                )}
                {previewHtml && (
                  <iframe
                    data-testid="ai-scenario-html-frame"
                    title="Scenario HTML preview"
                    srcDoc={previewHtml}
                    style={{
                      width: '100%',
                      minHeight: 480,
                      height: '60vh',
                      border: '1px solid var(--color-border)',
                    }}
                  />
                )}
                <button
                  data-testid="ai-scenario-html-preview-close"
                  onClick={() => {
                    setPreviewOpen(false)
                    setPreviewHtml(null)
                    setPreviewError(null)
                  }}
                >
                  Close preview
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {docWarnings.length > 0 && (
              <div data-testid="ai-scenario-warnings" className="scenario-warnings">
                <div className="scenario-warnings-title">
                  Doc warnings ({docWarnings.length})
                  <button
                    data-testid="ai-scenario-warnings-send"
                    disabled={!conversationId}
                    title={
                      conversationId
                        ? 'Send warnings to the assistant as a fix request'
                        : 'Start a conversation to send fix requests'
                    }
                    onClick={handleSendWarnings}
                  >
                    Send to assistant
                  </button>
                </div>
                <ul>
                  {docWarnings.map((warning, index) => (
                    <li key={index}>
                      <code>[{warning.code}]</code>
                      {warning.step ? ` step ${warning.step}` : ''}: {warning.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div
              data-testid="ai-scenario-modal-body"
              style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 8 }}
            >
              <div>
                <AiScenarioDocComments
                  projectId={projectId}
                  conversationId={conversationId}
                  context={context}
                  markdown={markdown}
                  comments={docComments}
                  onCommentsChange={setDocComments}
                />
              </div>
              <AiScenarioChecklist
                projectId={projectId}
                onMutated={() => setScenarioRev((n) => n + 1)}
              />
            </div>
          </>
        )}

        <div data-testid="ai-scenario-legacy">
          <h4>Action Scenario (legacy)</h4>
          <div className="ai-scenario__request">
            <input
              data-testid="ai-scenario-request"
              placeholder="Describe the lesson to scenario…"
              value={scenarioRequest}
              onChange={(e) => store.setScenarioRequest(e.target.value)}
            />
            <button
              data-testid="ai-scenario-propose"
              disabled={!conversationId || !scenarioRequest.trim() || scenarioGenerating}
              onClick={handlePropose}
            >
              Draft scenario
            </button>
            <button
              data-testid="ai-scenario-revise"
              disabled={
                !conversationId ||
                !scenarioRequest.trim() ||
                !activeScenarioId ||
                scenarioGenerating
              }
              onClick={handleRevise}
            >
              Revise scenario
            </button>
            {scenarioGenerating && (
              <span data-testid="ai-scenario-generating">Drafting scenario…</span>
            )}
            {scenarioError && <span data-testid="ai-scenario-error">{scenarioError.message}</span>}
          </div>

          {scenarios.length > 0 && (
            <select
              data-testid="ai-scenario-select"
              value={activeScenarioId ?? ''}
              onChange={(e) => store.setActiveScenario(e.target.value || null)}
            >
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.title} ({scenario.status})
                </option>
              ))}
            </select>
          )}

          {activeScenario ? (
            <AiScenarioEditor
              key={`${activeScenario.id}-${activeScenario.modified}`}
              scenario={activeScenario}
            />
          ) : (
            <div data-testid="ai-scenario-empty">
              No action scenario yet — describe the lesson above.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AiScenarioEditor({ scenario }: { scenario: AiScenario }) {
  const [titleDraft, setTitleDraft] = useState(scenario.title)
  const [descriptionDraft, setDescriptionDraft] = useState(scenario.description)
  const [stepDrafts, setStepDrafts] = useState<Record<string, Partial<AiScenarioStep>>>({})
  const store = useAiStore.getState()

  const handleSaveEdits = () => {
    const patch: {
      title?: string
      description?: string
      steps?: {
        id: string
        partTag?: AiScenarioStep['partTag']
        spokenLine?: string
        onScreenAction?: string
        assetHints?: string[]
        estimatedDurationSec?: number
      }[]
    } = {}
    if (titleDraft.trim() && titleDraft !== scenario.title) patch.title = titleDraft.trim()
    if (descriptionDraft !== scenario.description) patch.description = descriptionDraft
    const stepPatches = scenario.steps
      .map((step) => {
        const draft = stepDrafts[step.id]
        if (!draft) return null
        const item: {
          id: string
          partTag?: AiScenarioStep['partTag']
          spokenLine?: string
          onScreenAction?: string
          assetHints?: string[]
          estimatedDurationSec?: number
        } = { id: step.id }
        let touched = false
        if (draft.partTag !== undefined && draft.partTag !== step.partTag) {
          item.partTag = draft.partTag
          touched = true
        }
        if (draft.spokenLine !== undefined && draft.spokenLine !== step.spokenLine) {
          item.spokenLine = draft.spokenLine
          touched = true
        }
        if (draft.onScreenAction !== undefined && draft.onScreenAction !== step.onScreenAction) {
          item.onScreenAction = draft.onScreenAction
          touched = true
        }
        if (draft.assetHints !== undefined && draft.assetHints !== step.assetHints) {
          item.assetHints = draft.assetHints
          touched = true
        }
        if (
          draft.estimatedDurationSec !== undefined &&
          draft.estimatedDurationSec !== step.estimatedDurationSec
        ) {
          item.estimatedDurationSec = draft.estimatedDurationSec
          touched = true
        }
        return touched ? item : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    if (stepPatches.length > 0) patch.steps = stepPatches
    if (Object.keys(patch).length === 0) return
    void store.updateScenario(scenario.id, patch)
  }

  const handleMoveStep = (stepId: string, direction: -1 | 1) => {
    const ordered = [...scenario.steps].sort((a, b) => a.order - b.order)
    const index = ordered.findIndex((s) => s.id === stepId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ordered.length) return
    const swapped = [...ordered]
    const [moved] = swapped.splice(index, 1)
    swapped.splice(target, 0, moved)
    void store.updateScenario(
      scenario.id,
      // Order is the list order; lines/actions/hints ride along unchanged.
      { steps: swapped.map((s) => ({ id: s.id })) },
    )
  }

  const setStepDraft = (stepId: string, patch: Partial<AiScenarioStep>) => {
    setStepDrafts((prev) => ({ ...prev, [stepId]: { ...prev[stepId], ...patch } }))
  }

  return (
    <div data-testid={`ai-scenario-${scenario.id}`}>
      <div className="ai-scenario__overview">
        <h4>Action Scenario</h4>
        <label>
          Title
          <input
            data-testid="ai-scenario-title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            data-testid="ai-scenario-description"
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
          />
        </label>
        <div data-testid="ai-scenario-status">Status: {scenario.status}</div>
        <div data-testid="ai-scenario-revisions">Revisions: {scenario.revisions.length}</div>
        <div data-testid="ai-scenario-gate">
          {scenario.status === 'accepted'
            ? 'Accepted — Stage B reconciliation reads this version.'
            : 'Stage B runs only on the accepted version.'}
        </div>
      </div>

      <div className="ai-scenario__steps">
        <h4>Steps</h4>
        {[...scenario.steps]
          .sort((a, b) => a.order - b.order)
          .map((step) => (
            <div key={step.id} data-testid={`ai-scenario-step-${step.id}`}>
              <div data-testid={`ai-scenario-step-tag-${step.id}`}>Part: {step.partTag}</div>
              <select
                data-testid={`ai-scenario-step-tag-input-${step.id}`}
                aria-label={`Step part tag ${step.id}`}
                value={stepDrafts[step.id]?.partTag ?? step.partTag}
                onChange={(e) =>
                  setStepDraft(step.id, {
                    partTag: e.target.value as AiScenarioStep['partTag'],
                  })
                }
              >
                <option value="intro">intro</option>
                <option value="middle">middle</option>
                <option value="outro">outro</option>
              </select>
              <div data-testid={`ai-scenario-step-spoken-${step.id}`}>{step.spokenLine}</div>
              <textarea
                data-testid={`ai-scenario-step-spoken-input-${step.id}`}
                aria-label={`Spoken line ${step.id}`}
                value={stepDrafts[step.id]?.spokenLine ?? step.spokenLine}
                onChange={(e) => setStepDraft(step.id, { spokenLine: e.target.value })}
              />
              <div data-testid={`ai-scenario-step-action-${step.id}`}>{step.onScreenAction}</div>
              <textarea
                data-testid={`ai-scenario-step-action-input-${step.id}`}
                aria-label={`On-screen action ${step.id}`}
                value={stepDrafts[step.id]?.onScreenAction ?? step.onScreenAction}
                onChange={(e) => setStepDraft(step.id, { onScreenAction: e.target.value })}
              />
              <div data-testid={`ai-scenario-step-hints-${step.id}`}>
                {(stepDrafts[step.id]?.assetHints ?? step.assetHints).join(', ')}
              </div>
              <input
                data-testid={`ai-scenario-step-hints-input-${step.id}`}
                aria-label={`Asset hints ${step.id}`}
                value={(stepDrafts[step.id]?.assetHints ?? step.assetHints).join(', ')}
                onChange={(e) =>
                  setStepDraft(step.id, {
                    assetHints: e.target.value
                      .split(',')
                      .map((h) => h.trim())
                      .filter(Boolean),
                  })
                }
              />
              <input
                data-testid={`ai-scenario-step-duration-${step.id}`}
                aria-label={`Step duration ${step.id}`}
                type="number"
                min={0}
                value={stepDrafts[step.id]?.estimatedDurationSec ?? step.estimatedDurationSec}
                onChange={(e) =>
                  setStepDraft(step.id, { estimatedDurationSec: Number(e.target.value) })
                }
              />
              <button
                data-testid={`ai-scenario-step-up-${step.id}`}
                onClick={() => handleMoveStep(step.id, -1)}
              >
                Move up
              </button>
              <button
                data-testid={`ai-scenario-step-down-${step.id}`}
                onClick={() => handleMoveStep(step.id, 1)}
              >
                Move down
              </button>
            </div>
          ))}
      </div>

      <div className="ai-scenario__actions">
        <button data-testid="ai-scenario-save" onClick={handleSaveEdits}>
          Save edits
        </button>
        <button
          data-testid="ai-scenario-accept"
          disabled={scenario.status === 'accepted'}
          onClick={() => void store.acceptScenario(scenario.id)}
        >
          Accept
        </button>
        <button
          data-testid="ai-scenario-reject"
          disabled={scenario.status === 'rejected'}
          onClick={() => void store.rejectScenario(scenario.id)}
        >
          Reject
        </button>
      </div>
    </div>
  )
}
