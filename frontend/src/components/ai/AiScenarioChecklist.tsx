import { useContext, useMemo, useState } from 'react'
import { EngineContext } from '../../app/engineContext'
import {
  buildScenarioAvailableIds,
  buildScenarioChecklistRows,
  checklistPromptFor,
  checklistTitleFor,
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
  const [copyState, setCopyState] = useState<{
    key: string
    status: 'copied' | 'failed'
  } | null>(null)
  const [, refreshChecklist] = useState(0)

  const markdown = engine?.project?.scenario?.currentMarkdown ?? ''
  // Re-render when the background server→portable sync mutates the doc:
  // setScenario is silent, so the revision bump is the refresh signal.
  const scenarioDocRev = useAiStore((s) => s.scenarioDocRevByProject[projectId] ?? 0)
  const bindings = useMemo(
    () => engine?.project?.scenario?.bindings ?? {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine?.project?.scenario?.bindings, engine?.project?.id, markdown, scenarioDocRev],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markdown, bindings, availableIds, scenarioDocRev],
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

  const handleCopyPrompt = async (row: ScenarioChecklistRow) => {
    try {
      await navigator.clipboard.writeText(checklistPromptFor(row.key, row.alt, row.brief))
      setCopyState({ key: row.key, status: 'copied' })
      window.setTimeout(() => setCopyState(null), 1800)
    } catch {
      setCopyState({ key: row.key, status: 'failed' })
      window.setTimeout(() => setCopyState(null), 2500)
    }
  }

  return (
    <div data-testid="ai-scenario-checklist" className="scenario-checklist">
      <div className="scenario-checklist-header">
        <strong>
          Asset checklist{' '}
          <span className="scenario-checklist-count">
            ({visible.length}/{rows.length})
          </span>
        </strong>
        <button
          data-testid="ai-scenario-checklist-filter"
          onClick={() => store.setScenarioMissingOnly(!missingOnly)}
        >
          {missingOnly ? 'Show all' : 'Show missing only'}
        </button>
      </div>
      {rows.length === 0 ? (
        <div data-testid="ai-scenario-checklist-empty" className="scenario-checklist-note">
          No visuals in the doc yet — add an `![alt](asset:key)` line to checklist it.
        </div>
      ) : visible.length === 0 ? (
        <div data-testid="ai-scenario-checklist-all-bound" className="scenario-checklist-note">
          All visuals bound — nothing missing.
        </div>
      ) : (
        <div className="scenario-checklist-rows">
          {visible.map((row) => {
            const title = checklistTitleFor(row.key, row.alt)
            const copied = copyState?.key === row.key
            return (
              <div
                key={row.key}
                data-testid={`ai-scenario-checklist-row-${row.key}`}
                className={
                  row.bound
                    ? 'scenario-checklist-row is-bound'
                    : row.hasBrief || row.reuse
                      ? 'scenario-checklist-row is-unbound'
                      : 'scenario-checklist-row is-missing'
                }
              >
                <div className="scenario-checklist-title-row">
                  <div className="scenario-checklist-title">{title}</div>
                  <button
                    type="button"
                    data-testid={`ai-scenario-checklist-copy-${row.key}`}
                    className="scenario-checklist-copy"
                    aria-label={
                      copied
                        ? copyState.status === 'copied'
                          ? 'Generation prompt copied'
                          : 'Copy generation prompt failed'
                        : `Copy generation prompt for ${title}`
                    }
                    title={
                      copied
                        ? copyState.status === 'copied'
                          ? 'Copied'
                          : 'Copy failed'
                        : 'Copy generation prompt'
                    }
                    onClick={() => void handleCopyPrompt(row)}
                  >
                    {copied
                      ? copyState.status === 'copied'
                        ? 'Copied'
                        : 'Copy failed'
                      : 'Copy prompt'}
                  </button>
                </div>
                <div className="scenario-checklist-key">
                  <code className="scenario-checklist-slug">asset:{row.key}</code>
                </div>
                <div data-testid={`ai-scenario-checklist-status-${row.key}`}>
                  {row.bound ? (
                    <span className="scenario-status-pill is-bound">
                      Bound — {row.bindingAssetId}
                    </span>
                  ) : row.hasBrief || row.reuse ? (
                    <span className="scenario-status-pill is-unbound">
                      Unbound — brief only{row.reuse ? ` (reuse ${row.reuse})` : ''}
                    </span>
                  ) : (
                    <span className="scenario-status-pill is-missing">
                      Unbound — missing brief and binding
                    </span>
                  )}
                </div>
                {row.brief && (
                  <div className="scenario-checklist-brief">
                    <span className="scenario-checklist-brief-label">Brief:</span> {row.brief}
                  </div>
                )}
                {row.label && (
                  <div className="scenario-checklist-label">
                    <span className="scenario-checklist-label-tag">Label:</span> {row.label}
                  </div>
                )}
                {row.reuse && (
                  <div className="scenario-checklist-reuse">
                    <span className="scenario-checklist-reuse-label">Reuse:</span> {row.reuse}
                  </div>
                )}
                <div className="scenario-checklist-controls">
                  <label className="scenario-checklist-field">
                    <span>Bind library asset</span>
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
                  <label className="scenario-checklist-field">
                    <span>Upload</span>
                    <input
                      data-testid={`ai-scenario-checklist-upload-${row.key}`}
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleUpload(row, e.target.files)}
                    />
                  </label>
                </div>
                {uploadError[row.key] && (
                  <div
                    data-testid={`ai-scenario-checklist-upload-error-${row.key}`}
                    className="scenario-checklist-error"
                  >
                    {uploadError[row.key]}
                  </div>
                )}
                <div className="scenario-checklist-brief-edit">
                  <input
                    data-testid={`ai-scenario-checklist-brief-input-${row.key}`}
                    aria-label={`Brief for ${row.key}`}
                    placeholder="Edit brief…"
                    value={briefDrafts[row.key] ?? row.brief ?? ''}
                    onChange={(e) =>
                      setBriefDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))
                    }
                  />
                  <button
                    data-testid={`ai-scenario-checklist-save-brief-${row.key}`}
                    onClick={() => handleSaveBrief(row)}
                  >
                    Edit brief
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div data-testid="ai-scenario-checklist-project" className="scenario-checklist-project">
        {projectId}
      </div>
    </div>
  )
}
