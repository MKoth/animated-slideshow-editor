import { useContext, useMemo, useState } from 'react'
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
import { parseScenarioMarkdown } from '../../engine/scenarioMarkdown'
import { useAiStore } from '../../stores/aiStore'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { AiScenarioChecklist } from './AiScenarioChecklist'
import { AiScenarioHistory } from './AiScenarioHistory'
import type { ScenarioMarkdownVersion } from '../../api/aiApi'

const EMPTY_MARKDOWN_VERSIONS: ScenarioMarkdownVersion[] = []

interface AiScenarioModalProps {
  projectId: string
  conversationId: string | null
}

/**
 * Doc-first scenario modal (issue #463, adopted Variant A).
 * Full doc center plus right-rail blocking checklist, top-bar Generate /
 * View / Download actions, Doc versus History tabs. Generate hard-blocked
 * while any live-scanned row is unbound; View explains itself before the
 * first render; View plus zip enable once HTML is ready with re-generation
 * allowed and a stale hint after doc edits. Deterministic chalk render
 * (#464) wires into Generate — pure client-side, no backend model call.
 */
export function AiScenarioModal({ projectId, conversationId }: AiScenarioModalProps) {
  const engine = useContext(EngineContext)?.engine
  const scenarioTab = useAiStore((s) => s.scenarioTab)
  const markdownVersions = useAiStore(
    (s) => s.markdownVersionsByProject[projectId] ?? EMPTY_MARKDOWN_VERSIONS,
  )
  const store = useAiStore.getState()
  const allDefinitions = useAssetLibraryStore((s) => s.allDefinitions)
  const definitions = useAssetLibraryStore((s) => s.definitions)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [scenarioRev, setScenarioRev] = useState(0)

  const scenario = engine?.project?.scenario
  const markdown = scenario?.currentMarkdown ?? ''
  const bindings = scenario?.bindings ?? {}
  const lastHtml = scenario?.lastHtml
  const generatedFromVersionId = scenario?.generatedFromVersionId ?? null
  const portableVersions = useMemo(
    () => scenario?.versions ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario, scenarioRev],
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
    [markdown, bindings, availableIds, scenarioRev],
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

  return (
    <div data-testid="ai-scenario-modal" role="dialog" aria-label="Scenario">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <strong>Scenario</strong>
        <button
          data-testid="ai-scenario-generate"
          disabled={generateBlocked}
          title={generateBlocked ? `Blocked — ${unboundCount} unbound` : 'Generate HTML'}
          onClick={handleGenerate}
        >
          {generateBlocked ? `Generate HTML (blocked — ${unboundCount} unbound)` : 'Generate HTML'}
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
          disabled={downloadBlocked}
          title={
            downloadBlocked
              ? generateBlocked
                ? `Blocked — ${unboundCount} unbound`
                : 'No HTML yet — generate first'
              : 'Download zip'
          }
          // Portable zip with manifest lands in #465; same bytes-required gate.
          onClick={() => undefined}
        >
          Download .zip
        </button>
        <button
          data-testid="ai-scenario-modal-close"
          onClick={() => store.setScenarioModalOpen(false)}
        >
          Close
        </button>
      </div>

      <div data-testid="ai-scenario-unbound-count">
        {generateBlocked ? `${unboundCount} unbound` : 'All visuals bound'}
      </div>
      <div data-testid="ai-scenario-html-state">html: {htmlState}</div>
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
        <div
          data-testid="ai-scenario-modal-body"
          style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 8 }}
        >
          <div>
            <div data-testid="ai-scenario-modal-doc">
              {markdown ? (
                <pre style={{ whiteSpace: 'pre-wrap' }}>{markdown}</pre>
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
      )}
    </div>
  )
}
