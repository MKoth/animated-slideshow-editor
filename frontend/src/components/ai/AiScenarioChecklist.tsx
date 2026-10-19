import { useContext, useMemo, useState } from 'react'
import { EngineContext } from '../../app/engineContext'
import {
  buildScenarioAvailableIds,
  buildScenarioChecklistRows,
  updateScenarioBrief,
  type ScenarioChecklistRow,
} from '../../engine/scenarioChecklist'
import { withScenarioBindings, withScenarioMarkdown } from '../../engine/scenarioSection'
import { useAiStore } from '../../stores/aiStore'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'

interface AiScenarioChecklistProps {
  projectId: string
  onMutated?: () => void
}

/**
 * Right-rail asset checklist (issue #463).
 * Rows keyed by normalized asset key from a live markdown scan on every
 * render; stored bindings never create rows. Bound means a stored binding
 * resolves to a known library or embedded asset id — brief text alone never
 * unblocks. Each row resolves in one click: bind select, file upload, or
 * brief save all write via plain `project.setScenario` (no engine history).
 */
export function AiScenarioChecklist({ projectId, onMutated }: AiScenarioChecklistProps) {
  const engine = useContext(EngineContext)?.engine
  const missingOnly = useAiStore((s) => s.scenarioMissingOnly ?? false)
  const allDefinitions = useAssetLibraryStore((s) => s.allDefinitions)
  const definitions = useAssetLibraryStore((s) => s.definitions)
  const store = useAiStore.getState()
  const [briefDrafts, setBriefDrafts] = useState<Record<string, string>>({})
  const [uploadError, setUploadError] = useState<Record<string, string>>({})
  const [, refreshChecklist] = useState(0)

  const markdown = engine?.project?.scenario?.currentMarkdown ?? ''
  const bindings = useMemo(
    () => engine?.project?.scenario?.bindings ?? {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine?.project?.scenario?.bindings, engine?.project?.id, markdown],
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

  const libraryOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>()
    for (const d of [...allDefinitions, ...definitions]) {
      if (!seen.has(d.id)) seen.set(d.id, { id: d.id, name: d.name })
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [allDefinitions, definitions])

  const rows = useMemo(
    () => buildScenarioChecklistRows(markdown, bindings, availableIds),
    [markdown, bindings, availableIds],
  )
  const visible = missingOnly ? rows.filter((r) => !r.bound) : rows

  const handleBind = (row: ScenarioChecklistRow, assetId: string) => {
    if (!engine?.project?.scenario) return
    const current = engine.project.scenario
    if (!assetId) {
      const nextBindings = { ...current.bindings }
      delete nextBindings[row.key]
      engine.project.setScenario(withScenarioBindings(current, nextBindings))
    } else {
      engine.project.setScenario(
        withScenarioBindings(current, { ...current.bindings, [row.key]: assetId }),
      )
    }
    refreshChecklist((n) => n + 1)
    onMutated?.()
  }

  const handleUpload = async (row: ScenarioChecklistRow, files: FileList | null) => {
    if (!files || files.length === 0 || !engine?.project?.scenario) return
    setUploadError((prev) => {
      const next = { ...prev }
      delete next[row.key]
      return next
    })
    try {
      const result = await useAssetLibraryStore.getState().importFiles([...files])
      const created = result.created[0]
      if (!created) {
        setUploadError((prev) => ({ ...prev, [row.key]: 'Upload produced no asset.' }))
        return
      }
      const current = engine.project.scenario
      if (!current) return
      engine.project.setScenario(
        withScenarioBindings(current, { ...current.bindings, [row.key]: created.id }),
      )
      refreshChecklist((n) => n + 1)
      onMutated?.()
    } catch (error) {
      setUploadError((prev) => ({
        ...prev,
        [row.key]: error instanceof Error ? error.message : 'Upload failed.',
      }))
    }
  }

  const handleSaveBrief = (row: ScenarioChecklistRow) => {
    if (!engine?.project?.scenario) return
    const draft = briefDrafts[row.key] ?? row.brief ?? ''
    const current = engine.project.scenario
    const nextMarkdown = updateScenarioBrief(current.currentMarkdown, row.key, draft)
    engine.project.setScenario(withScenarioMarkdown(current, nextMarkdown))
    refreshChecklist((n) => n + 1)
    onMutated?.()
  }

  return (
    <div data-testid="ai-scenario-checklist">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <strong>
          Asset checklist ({visible.length}/{rows.length})
        </strong>
        <button
          data-testid="ai-scenario-checklist-filter"
          onClick={() => store.setScenarioMissingOnly(!missingOnly)}
        >
          {missingOnly ? 'Show all' : 'Show missing only'}
        </button>
      </div>
      {rows.length === 0 ? (
        <div data-testid="ai-scenario-checklist-empty">
          No visuals in the doc yet — add an `![alt](asset:key)` line to checklist it.
        </div>
      ) : visible.length === 0 ? (
        <div data-testid="ai-scenario-checklist-all-bound">
          All visuals bound — nothing missing.
        </div>
      ) : (
        visible.map((row) => (
          <div
            key={row.key}
            data-testid={`ai-scenario-checklist-row-${row.key}`}
            style={{ border: '1px solid #888', borderRadius: 6, padding: 8, marginBottom: 6 }}
          >
            <div>
              <code>{row.alt}</code> → <code>asset:{row.key}</code>
            </div>
            <div data-testid={`ai-scenario-checklist-status-${row.key}`}>
              {row.bound ? (
                <span>Bound — {row.bindingAssetId}</span>
              ) : row.hasBrief || row.reuse ? (
                <span>Unbound — brief only{row.reuse ? ` (reuse ${row.reuse})` : ''}</span>
              ) : (
                <span>Unbound — missing brief and binding</span>
              )}
            </div>
            {row.brief && <div style={{ opacity: 0.8 }}>Brief: {row.brief}</div>}
            {row.reuse && <div style={{ opacity: 0.8 }}>Reuse: {row.reuse}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <label>
                Bind library asset{' '}
                <select
                  data-testid={`ai-scenario-checklist-bind-${row.key}`}
                  value={row.bindingAssetId ?? ''}
                  onChange={(e) => handleBind(row, e.target.value)}
                >
                  <option value="">Unbound</option>
                  {libraryOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Upload{' '}
                <input
                  data-testid={`ai-scenario-checklist-upload-${row.key}`}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleUpload(row, e.target.files)}
                />
              </label>
            </div>
            {uploadError[row.key] && (
              <div data-testid={`ai-scenario-checklist-upload-error-${row.key}`}>
                {uploadError[row.key]}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                data-testid={`ai-scenario-checklist-brief-input-${row.key}`}
                aria-label={`Brief for ${row.key}`}
                placeholder="Edit brief…"
                value={briefDrafts[row.key] ?? row.brief ?? ''}
                onChange={(e) => setBriefDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))}
              />
              <button
                data-testid={`ai-scenario-checklist-save-brief-${row.key}`}
                onClick={() => handleSaveBrief(row)}
              >
                Edit brief
              </button>
            </div>
          </div>
        ))
      )}
      <div data-testid="ai-scenario-checklist-project">{projectId}</div>
    </div>
  )
}
