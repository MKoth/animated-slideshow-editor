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
  createEmptyScenarioSection,
  createScenarioVersion,
  withScenarioHtml,
} from '../../engine/scenarioSection'
import { buildScenarioImageFiles, renderScenarioChalkHtml } from '../../engine/scenarioChalkRender'
import {
  base64ToUint8Array,
  buildScenarioPortablePack,
  encodeScenarioPortableZip,
  yieldToEventLoop,
} from '../../engine/scenarioPortableZip'
import { parseScenarioMarkdown } from '../../engine/scenarioMarkdown'
import { useAiStore } from '../../stores/aiStore'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { AiScenarioChecklist } from './AiScenarioChecklist'
import { AiScenarioHistory } from './AiScenarioHistory'
import { ScenarioDocMarkdown } from '../../ai/markdown'
import type { AiScenario, AiScenarioStep, ScenarioMarkdownVersion } from '../../api/aiApi'

const EMPTY_MARKDOWN_VERSIONS: ScenarioMarkdownVersion[] = []

interface AiScenarioModalProps {
  projectId: string
  conversationId: string | null
  context?: unknown
}

/**
 * Doc-first scenario modal (issue #463, adopted Variant A).
 * Full doc center plus right-rail blocking checklist, top-bar Generate /
 * View / Download actions, Doc versus History tabs. Generate hard-blocked
 * while any live-scanned row is unbound; View explains itself before the
 * first render; View plus zip enable once HTML is ready with re-generation
 * allowed and a stale hint after doc edits. Deterministic chalk render
 * (#464) wires into Generate — pure client-side, no backend model call.
 * Portable zip with manifest (#465) shares the same bytes-required gate
 * and resolves the same embedded/library bytes through its own builder.
 */
export function AiScenarioModal({ projectId, conversationId, context }: AiScenarioModalProps) {
  const engine = useContext(EngineContext)?.engine
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
  const [scenarioRev, setScenarioRev] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [copyMdState, setCopyMdState] = useState<'copied' | 'failed' | null>(null)

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

  const handleGenerate = () => {
    const engineValue = engine
    if (!engineValue?.project || generateBlocked) return
    const current = engineValue.project.scenario ?? createEmptyScenarioSection(markdown)
    const currentMarkdown = current.currentMarkdown ?? markdown

    // Resolve each bound key to a filename hint (mime + original name) so
    // render and the later zip builder share the slug mapping.
    const byId = new Map<string, { mime?: string; filenameHint?: string }>()
    for (const asset of engineValue.embeddedAssets ?? []) {
      byId.set(asset.id, { mime: asset.mimeType, filenameHint: asset.name })
    }
    for (const def of [...allDefinitions, ...definitions]) {
      if (!byId.has(def.id)) {
        byId.set(def.id, { mime: def.mimeType, filenameHint: def.original_filename })
      }
    }
    const keys = rows.map((row) => row.key)
    const imageFiles = buildScenarioImageFiles(keys, (key) => {
      const binding = current.bindings[key]
      if (!binding) return undefined
      return byId.get(binding)
    })
    const html = renderScenarioChalkHtml(currentMarkdown, { imageFiles })

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
    engineValue.project.setScenario(withScenarioHtml(next, html, pointer))
    setScenarioRev((n) => n + 1)
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
      const byMeta = new Map<string, { mime?: string; filenameHint?: string }>()
      const embeddedById = new Map<string, { data: string; mimeType: string; name: string }>()
      for (const asset of engineValue.embeddedAssets ?? []) {
        byMeta.set(asset.id, { mime: asset.mimeType, filenameHint: asset.name })
        embeddedById.set(asset.id, { data: asset.data, mimeType: asset.mimeType, name: asset.name })
      }
      const defById = new Map<string, { mime?: string; filenameHint?: string; url?: string }>()
      for (const def of [...allDefinitions, ...definitions]) {
        if (!byMeta.has(def.id)) {
          byMeta.set(def.id, { mime: def.mimeType, filenameHint: def.original_filename })
        }
        if (!defById.has(def.id)) {
          defById.set(def.id, {
            mime: def.mimeType,
            filenameHint: def.original_filename,
            url: def.original_url,
          })
        }
      }
      const keys = rows.map((row) => row.key)
      const imageFiles = buildScenarioImageFiles(keys, (key) => {
        const binding = current.bindings[key]
        if (!binding) return undefined
        return byMeta.get(binding)
      })
      // Resolve bytes per key with periodic yields so large packs stay
      // responsive; any missing bytes abort instead of shipping broken refs.
      const imageBytes: Record<string, { bytes: Uint8Array; mime: string }> = {}
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i]!
        const binding = current.bindings[key]
        if (!binding) throw new Error(`Scenario pack is missing a binding for asset "${key}"`)
        const embedded = embeddedById.get(binding)
        if (embedded) {
          imageBytes[key] = {
            bytes: base64ToUint8Array(embedded.data),
            mime: embedded.mimeType,
          }
        } else {
          const def = defById.get(binding)
          if (!def?.url) throw new Error(`Scenario pack is missing image bytes for asset "${key}"`)
          const response = await fetch(def.url)
          if (!response.ok)
            throw new Error(`Scenario pack could not fetch bytes for asset "${key}"`)
          const buffer = await response.arrayBuffer()
          if (buffer.byteLength === 0) {
            throw new Error(`Scenario pack fetched empty bytes for asset "${key}"`)
          }
          const mime =
            def.mime ?? response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'image/png'
          imageBytes[key] = { bytes: new Uint8Array(buffer), mime }
        }
        if (i % 8 === 7) await yieldToEventLoop()
      }
      const pack = buildScenarioPortablePack({
        markdown: currentMarkdown,
        imageFiles,
        imageBytes,
        title: engineValue.project.name,
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

  const handleClose = () => {
    setConfirmingDelete(false)
    setDeleteError(null)
    setCopyMdState(null)
    store.setScenarioModalOpen(false)
  }

  // Clean slate: first click arms, second click deletes server versions plus
  // the portable doc copy (markdown, versions, bindings, stored HTML).
  // Plain project.setScenario — never through the engine Undo Stack.
  const handleDelete = () => {
    const engineValue = engine
    if (!engineValue?.project || markdownBusy) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      setDeleteError(null)
      return
    }
    setConfirmingDelete(false)
    setDeleteError(null)
    void store.clearMarkdownVersions(projectId).then((ok) => {
      if (!ok || !engineValue.project) {
        setDeleteError(useAiStore.getState().markdownError?.message ?? 'Clear failed — retry.')
        return
      }
      engineValue.project.setScenario(createEmptyScenarioSection(''))
      setScenarioRev((n) => n + 1)
    })
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
            disabled={generateBlocked}
            title={generateBlocked ? `Blocked — ${unboundCount} unbound` : 'Generate HTML'}
            onClick={handleGenerate}
          >
            {generateBlocked
              ? `Generate HTML (blocked — ${unboundCount} unbound)`
              : 'Generate HTML'}
          </button>
          <button
            data-testid="ai-scenario-view"
            disabled={htmlState === 'empty'}
            title={htmlState === 'empty' ? 'No HTML yet — generate first' : 'View stored HTML'}
            onClick={() => {
              if (htmlState !== 'empty') setPreviewOpen(true)
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
            data-testid="ai-scenario-delete"
            disabled={markdownBusy}
            title={
              confirmingDelete
                ? 'Click again to permanently delete the doc, history, and HTML'
                : 'Delete doc and HTML'
            }
            onClick={handleDelete}
          >
            {confirmingDelete ? 'Confirm delete doc + HTML?' : 'Delete'}
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
        </div>

        {scenarioTab === 'history' ? (
          <AiScenarioHistory projectId={projectId} conversationId={conversationId} />
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
                <div data-testid="ai-scenario-modal-doc" className="ai-scenario-modal-doc">
                  {markdown ? (
                    <ScenarioDocMarkdown content={markdown} />
                  ) : (
                    <div data-testid="ai-scenario-modal-empty">
                      No scenario markdown yet — chat to iterate or edit the doc.
                    </div>
                  )}
                </div>
                {previewOpen && htmlState !== 'empty' && lastHtml && (
                  <div data-testid="ai-scenario-html-preview">
                    <div>Preview (stored HTML{htmlState === 'stale' ? ' — stale' : ''})</div>
                    <iframe
                      data-testid="ai-scenario-html-frame"
                      title="Scenario HTML preview"
                      srcDoc={lastHtml}
                    />
                    <button
                      data-testid="ai-scenario-html-preview-close"
                      onClick={() => setPreviewOpen(false)}
                    >
                      Close preview
                    </button>
                  </div>
                )}
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
