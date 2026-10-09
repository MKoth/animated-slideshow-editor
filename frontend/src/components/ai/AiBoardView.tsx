import { useEffect, useState } from 'react'
import {
  boardAcceptBlockers,
  buildBoardCommands,
  marksMapForParts,
  type BoardPart,
} from '../../ai/board'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { computeProjectFingerprint } from '../../ai/proposals'
import { useEngine } from '../../app/useEngine'
import { useAiStore } from '../../stores/aiStore'

interface AiBoardViewProps {
  projectId: string
  narrationId: string | null
  conversationId: string | null
  disabled?: boolean
}

function toHelperParts(
  parts: {
    stepId: string
    order: number
    spokenLine: string
    timelineStart: number
    timelineEnd: number
    audioDuration: number | null
    estimatedDuration: number
  }[],
): BoardPart[] {
  return parts.map((p) => ({
    stepId: p.stepId,
    order: p.order,
    spokenLine: p.spokenLine,
    timelineStart: p.timelineStart,
    timelineEnd: p.timelineEnd,
    audioDuration: p.audioDuration,
    estimatedDuration: p.estimatedDuration,
  }))
}

export function AiBoardView({
  projectId,
  narrationId,
  conversationId,
  disabled,
}: AiBoardViewProps) {
  const { engine } = useEngine()
  const boards = useAiStore((s) => s.boards)
  const boardById = useAiStore((s) => s.boardById)
  const activeBoardId = useAiStore((s) => s.activeBoardId)
  const boardBusy = useAiStore((s) => s.boardBusy)
  const boardError = useAiStore((s) => s.boardError)
  const narrationById = useAiStore((s) => s.narrationById)
  const store = useAiStore.getState()

  const active = activeBoardId ? (boardById[activeBoardId] ?? null) : null
  const narration = narrationId ? (narrationById[narrationId] ?? null) : null

  const [edits, setEdits] = useState<Record<number, string>>({})
  const [slideIds, setSlideIds] = useState<Record<number, string>>({})
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (projectId) void store.loadBoards(projectId, narrationId ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, narrationId])

  useEffect(() => {
    if (activeBoardId) void store.loadBoard(activeBoardId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBoardId])

  const handleSelectBoard = (id: string) => {
    setEdits({})
    setSlideIds({})
    setNote(null)
    store.setActiveBoard(id || null)
  }

  if (disabled) {
    return (
      <div className="ai-board" data-testid="ai-board-section">
        <div data-testid="ai-board-disabled">Board scripts unavailable — backend unreachable.</div>
      </div>
    )
  }

  const canRun = Boolean(projectId && narrationId && conversationId && !boardBusy)

  const handleRun = () => {
    if (!projectId || !narrationId || !conversationId || boardBusy) return
    setNote(null)
    // One fresh script per middle slide: start from a single template script
    // and let the author map it to the live middle slide. Sending every
    // project slide would duplicate the same marks across unrelated slides.
    void store.createBoard(projectId, narrationId, conversationId).then((board) => {
      if (!board) setNote('Board authoring failed — see the board section.')
    })
  }

  const handleSave = () => {
    if (!active || boardBusy) return
    const scripts = active.scripts.map((script, index) => ({
      slideId: (slideIds[index] ?? script.slideId ?? '').trim() || script.slideId,
      slideIndex: script.slideIndex ?? index,
      source: edits[index] ?? script.source,
    }))
    void store.updateBoardScripts(active.id, scripts).then(() => {
      setNote('Scripts saved — compile them through the Check seam before accepting.')
    })
  }

  const handleCompile = () => {
    if (!active || boardBusy) return
    try {
      const scripts = active.scripts.map((script, index) => ({
        slideId: (slideIds[index] ?? script.slideId ?? '').trim() || script.slideId,
        source: edits[index] ?? script.source,
      }))
      const footprints: {
        from: number
        to: number
        effects: { start: number; duration: number }[]
        entryVersions: Record<string, number>
      }[] = []
      const diagnostics: { severity: string; message: string }[] = []
      for (const [index, script] of scripts.entries()) {
        const slideId = script.slideId.trim()
        if (!slideId) {
          diagnostics.push({
            severity: 'error',
            message: `slide #${index}: no slideId mapped for this middle slide — map it before compiling`,
          })
          footprints.push({ from: 0, to: 0, effects: [], entryVersions: {} })
          continue
        }
        let slideExists = true
        try {
          engine.getSlide(slideId)
        } catch {
          slideExists = false
        }
        if (!slideExists) {
          diagnostics.push({
            severity: 'error',
            message: `slide #${index}: slide ${slideId} is not in the live project — map a live middle slide`,
          })
          footprints.push({ from: 0, to: 0, effects: [], entryVersions: {} })
          continue
        }
        const checked = checkAnimationScript(engine, slideId, script.source)
        footprints.push({
          from: checked.summary.from,
          to: checked.summary.to,
          effects: checked.effects.map((e) => ({ start: e.start, duration: e.duration })),
          entryVersions: { ...(checked.footprint.entryVersions as Record<string, number>) },
        })
        for (const d of checked.diagnostics) {
          diagnostics.push({ severity: d.severity, message: d.message })
        }
      }
      const parts = narration ? toHelperParts(narration.parts) : []
      const marksMap =
        parts.length > 0
          ? (marksMapForParts(parts) as Record<string, { stepId: string; time: number }>)
          : undefined
      void store
        .compileBoard(active.id, {
          footprints,
          ...(marksMap ? { marksMap } : {}),
          diagnostics,
        })
        .then(() => {
          setNote(
            diagnostics.some((d) => d.severity === 'error')
              ? 'Compiled with errors — invalid targets and unresolved bindings block the gate; fix them manually.'
              : 'Compiled — footprints and marks map reported; overruns block the gate with no auto-shift.',
          )
        })
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Compile failed.')
    }
  }

  const handlePropose = () => {
    if (!active || !conversationId) return
    try {
      const scripts = active.scripts.map((script, index) => ({
        slideId: (slideIds[index] ?? script.slideId ?? '').trim() || script.slideId,
        source: edits[index] ?? script.source,
      }))
      const commands = buildBoardCommands(scripts)
      const fingerprint = computeProjectFingerprint(engine)
      void store
        .createProposal({
          projectId,
          conversationId,
          title: `Stage E board: ${active.title}`,
          commands,
          projectFingerprint: fingerprint,
        })
        .then((proposal) => {
          setNote(
            proposal
              ? `Board proposal ${proposal.id} created — dry-run, approve, and execute it in the proposal section.`
              : 'Board proposal failed — see the proposal section.',
          )
        })
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Board proposal failed.')
    }
  }

  const helperBlockers =
    active && narration
      ? boardAcceptBlockers({
          parts: toHelperParts(narration.parts),
          scripts: active.scripts.map((s, i) => ({
            slideId: slideIds[i] ?? s.slideId,
            source: edits[i] ?? s.source,
          })),
          footprints: active.footprints,
          marksMap: active.marksMap as Record<string, unknown>,
          diagnostics: active.diagnostics.map((d) => ({
            severity: d.severity as 'error' | 'warning',
            message: d.message,
          })),
          checks: active.checks as { parts?: BoardPart[]; scene?: Record<string, unknown> },
        })
      : []

  return (
    <div className="ai-board" data-testid="ai-board-section">
      <div className="ai-board__request">
        <button
          data-testid="ai-board-run"
          disabled={!canRun}
          onClick={handleRun}
          title={
            !narrationId
              ? 'Accept a narration first — Stage E reads only the accepted version'
              : undefined
          }
        >
          Author board scripts from zero
        </button>
        {boardBusy && <span data-testid="ai-board-generating">Working…</span>}
        {boardError && <span data-testid="ai-board-error">{boardError.message}</span>}
      </div>

      {boards.length > 0 && (
        <select
          data-testid="ai-board-select"
          value={activeBoardId ?? ''}
          onChange={(e) => handleSelectBoard(e.target.value)}
        >
          {boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.title} ({board.status})
            </option>
          ))}
        </select>
      )}

      {active ? (
        <div data-testid="ai-board-detail">
          <div data-testid="ai-board-status">
            {active.status} — {active.scripts.length} middle slide(s)
          </div>
          <ul data-testid="ai-board-scripts">
            {active.scripts.map((script, index) => (
              <li key={`${script.slideIndex ?? index}`} data-testid={`ai-board-script-${index}`}>
                <label>
                  Slide id for middle slide #{index}
                  <input
                    data-testid={`ai-board-slide-${index}`}
                    placeholder="middle-slide-id"
                    value={slideIds[index] ?? script.slideId ?? ''}
                    onChange={(e) => setSlideIds((prev) => ({ ...prev, [index]: e.target.value }))}
                  />
                </label>
                <label>
                  Fresh script from zero (marks at every PrompterPart boundary)
                  <textarea
                    data-testid={`ai-board-source-${index}`}
                    rows={8}
                    cols={60}
                    value={edits[index] ?? script.source}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [index]: e.target.value }))}
                  />
                </label>
              </li>
            ))}
          </ul>
          <div>
            <button data-testid="ai-board-save" onClick={handleSave} disabled={boardBusy}>
              Save scripts
            </button>
            <button data-testid="ai-board-compile" onClick={handleCompile} disabled={boardBusy}>
              Compile through Check seam
            </button>
            <button data-testid="ai-board-propose" onClick={handlePropose}>
              Propose SetSlideAnimationScript
            </button>
            {note && <div data-testid="ai-board-note">{note}</div>}
          </div>
          {(active.blockers.length > 0 || helperBlockers.length > 0) && (
            <ul data-testid="ai-board-blockers">
              {[
                ...active.blockers,
                ...helperBlockers.filter((b) => !active.blockers.includes(b)),
              ].map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          <div>
            <button
              data-testid="ai-board-accept"
              disabled={active.status !== 'draft' || active.blockers.length > 0}
              onClick={() => void store.acceptBoard(active.id)}
              title={
                active.blockers.length > 0
                  ? 'Resolve overruns, targets, bindings, and scene checks before accepting'
                  : undefined
              }
            >
              Accept board
            </button>
            <button data-testid="ai-board-reject" onClick={() => void store.rejectBoard(active.id)}>
              Reject
            </button>
          </div>
          <div data-testid="ai-board-contract">
            One fresh script per middle slide from zero, marks at every part boundary. Effects stay
            inside their owning narration window — overruns block with no auto-shift. Content via
            create-then-reveal with built-ins only; disappear via opacity holds. No cat in the
            middle; static board camera unless the accepted scenario asks for a board move.
          </div>
        </div>
      ) : (
        <div data-testid="ai-board-empty">
          No board yet — accept a narration, then author hard-locked blackboard scripts.
        </div>
      )}
    </div>
  )
}
