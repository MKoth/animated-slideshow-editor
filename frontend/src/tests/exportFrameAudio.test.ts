import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { CreateAudioAssetCommand } from '../engine/commands'
import { resolveExportAudioBytes } from '../export/exportAudio'
import {
  captureExportFrameAt,
  restorePreviewSnapshot,
  savePreviewSnapshot,
} from '../export/frameCapture'
import { usePlaybackController } from '../stores/playbackStore'
import * as activeRenderer from '../pixi/renderer/activeRenderer'

function wavBase64(): string {
  const sampleRate = 44100
  const dataSize = sampleRate * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const write = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  const bytes = new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

beforeEach(() => {
  vi.restoreAllMocks()
  usePlaybackController.setState({ currentTimes: {}, status: 'stopped' })
})

describe('export audio bytes', () => {
  it('resolves embedded assets without network', async () => {
    const internal = createEngineInternal()
    internal.createProject({ name: 'Audio' })
    const undo = new UndoStack()
    const dispatcher = new CommandDispatcher(internal, undo, () => {})
    const res = dispatcher.dispatch(
      new CreateAudioAssetCommand({
        name: 'voice',
        data: wavBase64(),
        mimeType: 'audio/wav',
        metadata: { duration: 1, sampleRate: 44100, channels: 1 },
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw res.error
    const assetId = (res.inverse as { assetId: string }).assetId
    const resolved = await resolveExportAudioBytes(toReadOnly(internal), assetId)
    expect(resolved?.mimeType).toBe('audio/wav')
    expect(resolved?.data.length).toBeGreaterThan(0)
  })

  it('returns null for unknown assets', async () => {
    const internal = createEngineInternal()
    internal.createProject({ name: 'Audio' })
    await expect(resolveExportAudioBytes(toReadOnly(internal), 'missing-id')).resolves.toBeNull()
  })
})

describe('frame capture preview snapshot', () => {
  it('saves and restores playhead times and active slide', async () => {
    const internal = createEngineInternal()
    internal.createProject({ name: 'Snap' })
    const s1 = internal.createSlide('S1')
    internal.setSlideDuration(s1.id, 5)
    const s2 = internal.createSlide('S2')
    internal.setSlideDuration(s2.id, 5)
    internal.setActiveSlide(s1.id)
    usePlaybackController.getState().setCurrentTime(s1.id, 2, 5)
    const readonly = toReadOnly(internal)

    const snapshot = savePreviewSnapshot(readonly)
    expect(snapshot.activeSlideId).toBe(s1.id)
    expect(snapshot.times[s1.id]).toBe(2)

    internal.setActiveSlide(s2.id)
    usePlaybackController.getState().setCurrentTime(s2.id, 4, 5)
    restorePreviewSnapshot(readonly, snapshot)

    expect(usePlaybackController.getState().currentTimes[s1.id]).toBe(2)
    // Active slide is restored to the snapshot value.
    expect(readonly.activeSlideId).toBe(s1.id)
  })

  it('capture returns null when no renderer is mounted', async () => {
    const internal = createEngineInternal()
    internal.createProject({ name: 'NoCanvas' })
    const slide = internal.createSlide('S1')
    internal.setSlideDuration(slide.id, 1)
    vi.spyOn(activeRenderer, 'getActiveRenderer').mockReturnValue(null)
    const result = await captureExportFrameAt(toReadOnly(internal), slide.id, 0, 1)
    // jsdom has no canvas: falls through to null rather than throwing.
    expect(result).toBeNull()
  })
})
