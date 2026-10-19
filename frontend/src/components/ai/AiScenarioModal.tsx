import { useContext, useMemo, useState } from 'react'
import { EngineContext } from '../../app/engineContext'
import {
  buildScenarioAvailableIds,
  buildScenarioChecklistRows,
  getScenarioHtmlState,
  getScenarioUnboundCount,
  isScenarioGenerateBlocked,
} from '../../engine/scenarioChecklist'
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
 * allowed and a stale hint after doc edits. Actual HTML rendering (#464)
 * and zip packaging (#465) wire into these gated buttons — this modal owns
 * the shell, gating, and checklist resolution.
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

  const versionsForState = markdownVersions.length > 0 ? markdownVersions : portableVersions
  const htmlState = getScenarioHtmlState({
    lastHtml,
    currentMarkdown: markdown,
    generatedFromVersionId,
    versions: versionsForState,
  })

  const downloadBlocked = generateBlocked || htmlState === 'empty'

  return (
    <div data-testid="ai-scenario-modal" role="dialog" aria-label="Scenario">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <strong>Scenario</strong>
        <button
          data-testid="ai-scenario-generate"
          disabled={generateBlocked}
          title={generateBlocked ? `Blocked — ${unboundCount} unbound` : 'Generate HTML'}
          // Actual deterministic chalk render lands in #464; this shell owns gating.
          onClick={() => undefined}
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
