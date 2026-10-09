import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiCalibration } from '../api/aiApi'
import { EngineProvider } from '../app/EngineProvider'
import { AiCalibrationView } from '../components/ai/AiCalibrationView'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'

const sampleCalibration: AiCalibration = {
  id: 'cal-1',
  projectId: 'p-1',
  narrationId: 'nar-1',
  scenarioId: 'scen-1',
  conversationId: 'c-1',
  title: 'Cat calibration',
  status: 'draft',
  introRef: 'pregen-intro',
  outroRef: 'pregen-outro',
  phonemeMap: { AH: 'Open' },
  checks: {
    voice: { ok: true, message: 'voice reused from the accepted narration; pregen audio measured' },
    faceRig: { ok: false, message: 'no MorphBinding on the cat node' },
    camera: { ok: true, message: 'camera framing holds' },
  },
  timings: [
    {
      stepId: 'st-1',
      order: 0,
      partTag: 'intro',
      spokenLine: 'Hello friends, I am Mao!',
      audioDuration: 2.5,
      level: 0.4,
      words: [
        { word: 'Hello', start: 0, end: 0.5 },
        { word: 'friends,', start: 0.5, end: 1 },
      ],
      fallback: false,
      envelope: [],
      missingShapes: [],
    },
    {
      stepId: 'st-4',
      order: 1,
      partTag: 'outro',
      spokenLine: 'Goodbye friends!',
      audioDuration: 2,
      level: 0.5,
      words: [],
      fallback: true,
      envelope: [{ t: 1, open: 0.8 }],
      missingShapes: [],
    },
  ],
  blockers: ['face-rig: no MorphBinding on the cat node — author the mouth Shapes first'],
  fallbackCount: 1,
  revisions: [],
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
}

function seedStore() {
  useAiStore.setState({
    calibrations: [
      {
        id: 'cal-1',
        projectId: 'p-1',
        narrationId: 'nar-1',
        conversationId: 'c-1',
        title: 'Cat calibration',
        status: 'draft',
        partCount: 2,
        modified: new Date().toISOString(),
      },
    ],
    calibrationById: { 'cal-1': sampleCalibration },
    activeCalibrationId: 'cal-1',
    calibrationBusy: false,
    calibrationError: null,
  })
  useBackendStore.setState({ status: 'available' })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useAiStore.setState({
    conversations: [],
    messagesById: {},
    activeByProject: {},
    drafts: {},
    search: '',
    panelOpen: true,
    settingsOpen: false,
    status: 'idle',
    streamingConversationId: null,
    streamingContent: '',
    lastError: null,
  })
  seedStore()
})

function renderView(disabled = false) {
  return render(
    <EngineProvider>
      <AiCalibrationView
        projectId="p-1"
        narrationId="nar-1"
        conversationId="c-1"
        disabled={disabled}
      />
    </EngineProvider>,
  )
}

describe('AiCalibrationView Stage D gate', () => {
  it('renders verify-only checks with intro/outro timing and fallback marked', () => {
    renderView()
    expect(screen.getByTestId('ai-calibration-section')).toBeInTheDocument()
    expect(screen.getByTestId('ai-calibration-voice')).toHaveTextContent('pass')
    expect(screen.getByTestId('ai-calibration-facerig')).toHaveTextContent('fail')
    expect(screen.getByTestId('ai-calibration-camera')).toHaveTextContent('pass')
    expect(screen.getByTestId('ai-calibration-text-st-1')).toHaveTextContent('Hello friends')
    expect(screen.getByTestId('ai-calibration-text-st-1')).toHaveTextContent('intro')
    expect(screen.getByTestId('ai-calibration-timing-st-4')).toHaveTextContent('fallback')
    expect(screen.getByTestId('ai-calibration-timing-st-4')).toHaveTextContent('marked')
    // Gate blocked on the failing face-rig check.
    expect(screen.getByTestId('ai-calibration-accept')).toBeDisabled()
    expect(screen.getByTestId('ai-calibration-blockers')).toHaveTextContent('face-rig')
    // Verify-only contract is visible: no Shapes, audio, or bindings touched.
    expect(screen.getByTestId('ai-calibration-verify-note')).toHaveTextContent('Verify-only')
    expect(screen.getByTestId('ai-calibration-verify-note')).toHaveTextContent('middle is excluded')
    expect(screen.getByTestId('ai-calibration-verify-note')).toHaveTextContent('rotation is never')
  })

  it('mouth proposals require mapped cat nodes and stay coefficient-only', async () => {
    renderView()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    // No cat nodes mapped yet: the view asks for intro/outro mapping first.
    await user.click(screen.getByTestId('ai-calibration-propose-mouth'))
    expect(screen.getByTestId('ai-calibration-proposal-note')).toHaveTextContent('cat node')
  })

  it('shows degraded state when the backend is down', () => {
    renderView(true)
    expect(screen.getByTestId('ai-calibration-disabled')).toBeInTheDocument()
  })
})
