import { useEffect, useState } from 'react'
import {
  buildClipMouthCommands,
  buildControlMouthCommands,
  buildMouthCommands,
  calibrationAcceptBlockers,
  type CalibrationTiming,
} from '../../ai/calibration'
import { computeProjectFingerprint } from '../../ai/proposals'
import { useEngine } from '../../app/useEngine'
import { useAiStore } from '../../stores/aiStore'

interface AiCalibrationViewProps {
  projectId: string
  narrationId: string | null
  conversationId: string | null
  disabled?: boolean
}

const FALLBACK_PEAKS = Array.from({ length: 800 }, (_, i) => (i * 37) % 256)

export function AiCalibrationView({
  projectId,
  narrationId,
  conversationId,
  disabled,
}: AiCalibrationViewProps) {
  const { engine } = useEngine()
  const calibrations = useAiStore((s) => s.calibrations)
  const calibrationById = useAiStore((s) => s.calibrationById)
  const activeCalibrationId = useAiStore((s) => s.activeCalibrationId)
  const calibrationBusy = useAiStore((s) => s.calibrationBusy)
  const calibrationError = useAiStore((s) => s.calibrationError)
  const store = useAiStore.getState()

  const active = activeCalibrationId ? (calibrationById[activeCalibrationId] ?? null) : null

  const [nodeIds, setNodeIds] = useState<Record<string, string>>({})
  const [proposalNote, setProposalNote] = useState<string | null>(null)
  const [mouthShapesText, setMouthShapesText] = useState('Open, Closed')
  const [bindingFrom, setBindingFrom] = useState('Closed')
  const [bindingTo, setBindingTo] = useState('Open')

  useEffect(() => {
    if (projectId) void store.loadCalibrations(projectId, narrationId ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, narrationId])

  useEffect(() => {
    if (activeCalibrationId) void store.loadCalibration(activeCalibrationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCalibrationId])

  if (disabled) {
    return (
      <div className="ai-calibration" data-testid="ai-calibration-section">
        <div data-testid="ai-calibration-disabled">
          Calibration unavailable — backend unreachable.
        </div>
      </div>
    )
  }

  const canRun = Boolean(projectId && narrationId && conversationId && !calibrationBusy)

  const handleRun = () => {
    if (!projectId || !narrationId || !conversationId || calibrationBusy) return
    setProposalNote(null)
    const mouthShapes = mouthShapesText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    void store.createCalibration(projectId, narrationId, conversationId, {
      mouthShapes,
      morphBinding: { fromShape: bindingFrom.trim() || null, toShape: bindingTo.trim() || null },
    })
  }

  const handleFallback = (stepId: string) => {
    if (!active || calibrationBusy) return
    void store.fallbackCalibrationPart(active.id, stepId, FALLBACK_PEAKS)
  }

  const handleProposeMouth = (mode: 'coefficient' | 'control' | 'clip') => {
    if (!active || !conversationId) return
    try {
      const timings = active.timings as CalibrationTiming[]
      const mappedNodeIds: Record<string, string> = {}
      for (const timing of timings) {
        const nodeId = (nodeIds[timing.stepId] ?? '').trim()
        if (!nodeId) {
          setProposalNote(
            `Map a cat node for ${timing.partTag} part ${timing.stepId} first — mouth stays on intro/outro cat nodes.`,
          )
          return
        }
        mappedNodeIds[timing.stepId] = nodeId
      }
      const phonemeMap = active.phonemeMap as Record<string, string>
      const built =
        mode === 'control'
          ? buildControlMouthCommands(timings, mappedNodeIds, 'Open', phonemeMap)
          : mode === 'clip'
            ? buildClipMouthCommands(timings, mappedNodeIds, 'mouth-open', phonemeMap)
            : buildMouthCommands(timings, mappedNodeIds, phonemeMap)
      if (built.warnings.length > 0) {
        setProposalNote(
          `Soft-warn-and-skip: ${built.warnings.join('; ')} — author the missing mouth Shapes on the reusable cat object first.`,
        )
        return
      }
      const fingerprint = computeProjectFingerprint(engine)
      void store
        .createProposal({
          projectId,
          conversationId,
          title: `Stage D mouth (${mode}): ${active.title}`,
          commands: built.commands,
          projectFingerprint: fingerprint,
        })
        .then((proposal) => {
          setProposalNote(
            proposal
              ? `Mouth proposal ${proposal.id} created — dry-run, approve, and execute it in the proposal section.`
              : 'Mouth proposal failed — see the proposal section.',
          )
        })
    } catch (error) {
      setProposalNote(error instanceof Error ? error.message : 'Mouth proposal failed.')
    }
  }

  return (
    <div className="ai-calibration" data-testid="ai-calibration-section">
      <div className="ai-calibration__request">
        <button
          data-testid="ai-calibration-run"
          disabled={!canRun}
          onClick={handleRun}
          title={
            !narrationId
              ? 'Accept a narration first — Stage D reads only the accepted version'
              : undefined
          }
        >
          Calibrate intro/outro verify-only
        </button>
        <label>
          User-owned mouth Shapes (comma-separated, on the reusable cat object)
          <input
            data-testid="ai-calibration-mouth-shapes"
            value={mouthShapesText}
            onChange={(e) => setMouthShapesText(e.target.value)}
            placeholder="Open, Closed"
          />
        </label>
        <label>
          MorphBinding From
          <input
            data-testid="ai-calibration-binding-from"
            value={bindingFrom}
            onChange={(e) => setBindingFrom(e.target.value)}
            placeholder="Closed"
          />
        </label>
        <label>
          MorphBinding To
          <input
            data-testid="ai-calibration-binding-to"
            value={bindingTo}
            onChange={(e) => setBindingTo(e.target.value)}
            placeholder="Open"
          />
        </label>
        {calibrationBusy && <span data-testid="ai-calibration-generating">Working…</span>}
        {calibrationError && (
          <span data-testid="ai-calibration-error">{calibrationError.message}</span>
        )}
      </div>

      {calibrations.length > 0 && (
        <select
          data-testid="ai-calibration-select"
          value={activeCalibrationId ?? ''}
          onChange={(e) => store.setActiveCalibration(e.target.value || null)}
        >
          {calibrations.map((calibration) => (
            <option key={calibration.id} value={calibration.id}>
              {calibration.title} ({calibration.status})
            </option>
          ))}
        </select>
      )}

      {active ? (
        <AiCalibrationDetail
          calibrationId={active.id}
          status={active.status}
          checks={active.checks}
          timings={active.timings}
          blockers={active.blockers}
          fallbackCount={active.fallbackCount}
          nodeIds={nodeIds}
          onNodeIdChange={(stepId, value) => setNodeIds((prev) => ({ ...prev, [stepId]: value }))}
          onFallback={handleFallback}
          onProposeMouth={handleProposeMouth}
          proposalNote={proposalNote}
          busy={calibrationBusy}
        />
      ) : (
        <div data-testid="ai-calibration-empty">
          No calibration yet — accept a narration, then verify-only calibrate its intro/outro.
        </div>
      )}
    </div>
  )
}

interface AiCalibrationDetailProps {
  calibrationId: string
  status: string
  checks: {
    voice: { ok: boolean; message?: string }
    faceRig: { ok: boolean; message?: string }
    camera: { ok: boolean; message?: string }
  }
  timings: {
    stepId: string
    partTag: string
    spokenLine: string
    audioDuration: number | null
    level: number | null
    measured?: boolean
    words: { word: string; start: number; end: number }[]
    fallback: boolean
    envelope: { t: number; open: number }[]
    missingShapes: string[]
  }[]
  blockers: string[]
  fallbackCount: number
  nodeIds: Record<string, string>
  onNodeIdChange: (stepId: string, value: string) => void
  onFallback: (stepId: string) => void
  onProposeMouth: (mode: 'coefficient' | 'control' | 'clip') => void
  proposalNote: string | null
  busy: boolean
}

function AiCalibrationDetail({
  calibrationId,
  status,
  checks,
  timings,
  blockers,
  fallbackCount,
  nodeIds,
  onNodeIdChange,
  onFallback,
  onProposeMouth,
  proposalNote,
  busy,
}: AiCalibrationDetailProps) {
  const store = useAiStore.getState()
  const helperBlockers = calibrationAcceptBlockers({
    checks,
    timings: timings as CalibrationTiming[],
  })

  return (
    <div data-testid="ai-calibration-detail">
      <div data-testid="ai-calibration-status">
        {status} — {timings.length} intro/outro parts
        {fallbackCount > 0 ? ` (${fallbackCount} envelope fallback, marked)` : ''}
      </div>

      <ul data-testid="ai-calibration-checks">
        <li data-testid="ai-calibration-voice">
          Voice reuse: {checks.voice.ok ? 'pass' : 'fail'} — {checks.voice.message ?? ''}
        </li>
        <li data-testid="ai-calibration-facerig">
          Face-rig readiness: {checks.faceRig.ok ? 'pass' : 'fail'} — {checks.faceRig.message ?? ''}
        </li>
        <li data-testid="ai-calibration-camera">
          Camera framing: {checks.camera.ok ? 'pass' : 'fail'} — {checks.camera.message ?? ''}
        </li>
      </ul>

      <ul data-testid="ai-calibration-parts">
        {timings.map((timing) => (
          <li key={timing.stepId} data-testid={`ai-calibration-part-${timing.stepId}`}>
            <div data-testid={`ai-calibration-text-${timing.stepId}`}>
              [{timing.partTag}] {timing.spokenLine}
            </div>
            <div data-testid={`ai-calibration-timing-${timing.stepId}`}>
              pregen {timing.audioDuration?.toFixed(2) ?? '?'}s
              {timing.measured === false ? ' (estimated — measure pregen audio)' : ''}
              {timing.fallback
                ? ` — envelope fallback (${timing.envelope.length} Open keys, marked)`
                : timing.words.length > 0
                  ? ` — ${timing.words.length} phoneme-timed words`
                  : ' — untimed'}
            </div>
            <label>
              Cat node for this {timing.partTag} part
              <input
                data-testid={`ai-calibration-node-${timing.stepId}`}
                placeholder="cat-intro-node-id"
                value={nodeIds[timing.stepId] ?? ''}
                onChange={(e) => onNodeIdChange(timing.stepId, e.target.value)}
              />
            </label>
            {!timing.fallback && timing.words.length === 0 && (
              <button
                data-testid={`ai-calibration-fallback-${timing.stepId}`}
                disabled={busy}
                onClick={() => onFallback(timing.stepId)}
                title="Sends client-supplied peaks as the envelope source — wire to the real waveformPeaks feed for production pregen audio"
              >
                Record envelope fallback
              </button>
            )}
          </li>
        ))}
      </ul>

      <div>
        <button
          data-testid="ai-calibration-propose-mouth"
          onClick={() => onProposeMouth('coefficient')}
        >
          Propose mouth coefficients
        </button>
        <button
          data-testid="ai-calibration-propose-control"
          onClick={() => onProposeMouth('control')}
        >
          Propose control values
        </button>
        <button data-testid="ai-calibration-propose-clip" onClick={() => onProposeMouth('clip')}>
          Propose mouth clips
        </button>
        {proposalNote && <div data-testid="ai-calibration-proposal-note">{proposalNote}</div>}
      </div>

      {(blockers.length > 0 || helperBlockers.length > 0) && (
        <ul data-testid="ai-calibration-blockers">
          {[...blockers, ...helperBlockers.filter((b) => !blockers.includes(b))].map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
      <div>
        <button
          data-testid="ai-calibration-accept"
          disabled={status !== 'draft' || blockers.length > 0}
          onClick={() => void store.acceptCalibration(calibrationId)}
          title={
            blockers.length > 0
              ? 'Resolve the triple check and time every part before accepting'
              : undefined
          }
        >
          Accept calibration
        </button>
        <button
          data-testid="ai-calibration-reject"
          onClick={() => void store.rejectCalibration(calibrationId)}
        >
          Reject
        </button>
      </div>

      <div data-testid="ai-calibration-verify-note">
        Verify-only — creates no Shapes, rewrites no audio, rebinds no morphs. Mouth and camera stay
        on intro/outro cat nodes; the blackboard middle is excluded. Camera rotation is never
        written.
      </div>
    </div>
  )
}
