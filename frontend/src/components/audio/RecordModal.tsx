/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import {
  getPrompterRecordingShortcut,
  getPrompterMismatchThreshold,
  shouldShowMismatchDialog,
  getMismatchKind,
  computePlaybackRate,
} from '../../engine/prompter'
import {
  blobToBase64,
  decodeAudioMetadata,
  getRecordingErrorInfo,
  type RecordingErrorInfo,
} from '../../audio/recording'
import {
  CreateAudioAssetCommand,
  CreateAudioClipCommand,
  DeleteAudioClipCommand,
  SetPrompterPartAudioCommand,
  UpdatePrompterPartWithShiftCommand,
} from '../../engine/commands'
import { MismatchDialog } from './MismatchDialog'
import { useAudioResizePreferenceStore } from '../../stores/audioResizePreferenceStore'

type RecordingStatus = 'idle' | 'requesting' | 'recording' | 'processing' | 'error'

interface RecordModalProps {
  slideId: string
  partId: string
  partText: string
  partStartTime: number
  plannedDuration: number
  onClose: () => void
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>
  MediaRecorderCtor?: new (stream: MediaStream, opts?: MediaRecorderOptions) => MediaRecorder
  AudioContextCtor?: new () => AudioContext
}

export function RecordModal({
  slideId,
  partId,
  partText,
  partStartTime,
  plannedDuration,
  onClose,
  getUserMedia: injectedGetUserMedia,
  MediaRecorderCtor: InjectedRecorder,
  AudioContextCtor: InjectedAudioCtx,
}: RecordModalProps) {
  const { engine, dispatch } = useEngine()
  const slide = engine.getSlide(slideId)
  const part = slide.prompter?.parts.find((p) => p.id === partId)
  const shortcut = getPrompterRecordingShortcut(engine.project?.settings ?? {})

  const [status, setStatus] = useState<RecordingStatus>('idle')
  const [errorInfo, setErrorInfo] = useState<RecordingErrorInfo | null>(null)
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [showMismatch, setShowMismatch] = useState<null | {
    recordedDuration: number
    base64: string
    metadata: { duration: number; sampleRate: number; channels: number; waveformPeaks?: number[] }
    blobType: string
  }>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const blobsRef = useRef<Blob[]>([])

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect()
      } catch {
        /* ignore */
      }
      analyserRef.current = null
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close()
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop()
        } catch {
          /* ignore */
        }
      }
      streamRef.current = null
    }
    recorderRef.current = null
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  const getUserMediaFn =
    injectedGetUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c))
  const RecorderCtor =
    (InjectedRecorder as unknown as typeof MediaRecorder) ??
    (globalThis as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder
  const AudioCtor =
    (InjectedAudioCtx as unknown as typeof AudioContext) ??
    (
      globalThis as unknown as {
        AudioContext?: typeof AudioContext
        webkitAudioContext?: typeof AudioContext
      }
    ).AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  const commitRecording = useCallback(
    async (
      base64: string,
      metadata: {
        duration: number
        sampleRate: number
        channels: number
        waveformPeaks?: number[]
      },
      mimeType: string,
      playbackRate: number,
    ) => {
      if (part?.audioClipId) {
        try {
          dispatch(new DeleteAudioClipCommand({ slideId, clipId: part.audioClipId }))
        } catch {
          /* ignore */
        }
      }
      const assetMime = mimeType.startsWith('audio/') ? mimeType : 'audio/wav'
      const assetResult = dispatch(
        new CreateAudioAssetCommand({
          name: `Recording ${partText.slice(0, 20)}`,
          data: base64,
          mimeType: assetMime,
          metadata: {
            duration: metadata.duration,
            sampleRate: metadata.sampleRate,
            channels: metadata.channels,
            ...(metadata.waveformPeaks ? { waveformPeaks: metadata.waveformPeaks } : {}),
          },
        }),
      )
      if (!assetResult.ok) {
        setErrorInfo({
          kind: 'unknown',
          message: assetResult.error.message,
          hint: 'Failed to create asset',
          retryable: true,
        })
        setStatus('error')
        return
      }
      const assetId = (assetResult.inverse as { assetId: string }).assetId
      const clipResult = dispatch(
        new CreateAudioClipCommand({
          slideId,
          assetId,
          trackId: 'voice',
          timelineStart: partStartTime,
          sourceEnd: metadata.duration,
          playbackRate,
        }),
      )
      if (!clipResult.ok) {
        setErrorInfo({
          kind: 'unknown',
          message: clipResult.error.message,
          hint: 'Failed to create clip',
          retryable: true,
        })
        setStatus('error')
        return
      }
      const clipId = (clipResult.inverse as { clipId: string }).clipId
      const linkResult = dispatch(
        new SetPrompterPartAudioCommand({
          slideId,
          partId,
          audioClipId: clipId,
          audioAssetId: assetId,
        }),
      )
      if (!linkResult.ok) {
        setErrorInfo({
          kind: 'unknown',
          message: linkResult.error.message,
          hint: 'Failed to link',
          retryable: true,
        })
        setStatus('error')
        return
      }
      onClose()
    },
    [dispatch, slideId, partId, partText, partStartTime, part, onClose],
  )

  const handleStop = useCallback(async () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    const blob =
      blobsRef.current.length > 0
        ? new Blob(blobsRef.current, {
            type:
              (recorderRef.current as unknown as { mimeType?: string })?.mimeType || 'audio/webm',
          })
        : null
    if (!blob || blob.size === 0) {
      setErrorInfo({
        kind: 'unknown',
        message: 'No audio captured.',
        hint: 'Try recording again.',
        retryable: true,
      })
      setStatus('error')
      cleanup()
      return
    }
    setStatus('processing')
    try {
      const base64 = await blobToBase64(blob)
      const metadata = await decodeAudioMetadata(
        base64,
        InjectedAudioCtx ? () => new InjectedAudioCtx() : undefined,
      )
      const recordedDuration = metadata.duration
      const threshold = getPrompterMismatchThreshold(engine.project?.settings ?? {})
      if (shouldShowMismatchDialog(recordedDuration, plannedDuration, threshold)) {
        // Per-track Don't ask again — same memory as clip resize and TTS
        const pref = useAudioResizePreferenceStore.getState().getPreference('voice')
        if (pref === 'stretch') {
          const rate = computePlaybackRate(plannedDuration, recordedDuration)
          await commitRecording(base64, metadata, blob.type || 'audio/wav', rate)
          cleanup()
          return
        }
        if (pref === 'trim') {
          // Fit text to clip — will be handled via mismatch dialog's extend path, but auto-apply with shift true
          // For auto-apply, directly do the extend flow without dialog
          // Reuse handleMismatchChoice logic via direct commit
          const assetMime = (blob.type || 'audio/wav').startsWith('audio/')
            ? blob.type || 'audio/wav'
            : 'audio/wav'
          if (part?.audioClipId) {
            try {
              dispatch(new DeleteAudioClipCommand({ slideId, clipId: part.audioClipId }))
            } catch {
              /* ignore */
            }
          }
          const assetResult = dispatch(
            new CreateAudioAssetCommand({
              name: `Recording ${partText.slice(0, 20)}`,
              data: base64,
              mimeType: assetMime,
              metadata: {
                duration: metadata.duration,
                sampleRate: metadata.sampleRate,
                channels: metadata.channels,
                ...(metadata.waveformPeaks ? { waveformPeaks: metadata.waveformPeaks } : {}),
              },
            }),
          )
          if (assetResult.ok) {
            const assetId = (assetResult.inverse as { assetId: string }).assetId
            const clipResult = dispatch(
              new CreateAudioClipCommand({
                slideId,
                assetId,
                trackId: 'voice',
                timelineStart: partStartTime,
                sourceEnd: metadata.duration,
                playbackRate: 1,
              }),
            )
            if (clipResult.ok) {
              const clipId = (clipResult.inverse as { clipId: string }).clipId
              dispatch(
                new SetPrompterPartAudioCommand({
                  slideId,
                  partId,
                  audioClipId: clipId,
                  audioAssetId: assetId,
                }),
              )
              dispatch(
                new UpdatePrompterPartWithShiftCommand({
                  slideId,
                  partId,
                  duration: recordedDuration,
                  shiftDownstream: true,
                }),
              )
              onClose()
              cleanup()
              return
            }
          }
        }
        setShowMismatch({ recordedDuration, base64, metadata, blobType: blob.type || 'audio/wav' })
        setStatus('idle')
        return
      }
      await commitRecording(base64, metadata, blob.type || 'audio/wav', 1)
    } catch (e) {
      const info = getRecordingErrorInfo(e)
      setErrorInfo(info)
      setStatus('error')
    } finally {
      cleanup()
    }
  }, [
    plannedDuration,
    InjectedAudioCtx,
    engine.project,
    cleanup,
    commitRecording,
    dispatch,
    slideId,
    partId,
    partText,
    partStartTime,
    part,
    onClose,
  ])

  const startRecording = useCallback(async () => {
    if (part?.audioClipId || part?.audioAssetId) {
      const ok = window.confirm(
        'This part already has audio. Replace existing recording? Legacy asset will be retained.',
      )
      if (!ok) return
    }
    setErrorInfo(null)
    setStatus('requesting')
    setLevel(0)
    setElapsed(0)
    blobsRef.current = []
    try {
      const stream = await getUserMediaFn({ audio: true })
      streamRef.current = stream
      if (AudioCtor) {
        try {
          const ctx = new AudioCtor()
          audioCtxRef.current = ctx as AudioContext
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          analyserRef.current = analyser
          const source = ctx.createMediaStreamSource(stream)
          source.connect(analyser)
          const data = new Uint8Array(analyser.frequencyBinCount)
          const tick = () => {
            if (!analyserRef.current) return
            analyserRef.current.getByteFrequencyData(data)
            let sum = 0
            for (let i = 0; i < data.length; i++) sum += data[i]
            const avg = sum / data.length / 255
            setLevel(avg)
            rafRef.current = requestAnimationFrame(tick)
          }
          rafRef.current = requestAnimationFrame(tick)
        } catch {
          /* ignore analyser failure */
        }
      }
      if (!RecorderCtor) throw new Error('MediaRecorder not available')
      const recorder = new RecorderCtor(stream, {
        mimeType: 'audio/webm',
      } as unknown as MediaRecorderOptions)
      recorderRef.current = recorder
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) blobsRef.current.push(event.data)
      }
      recorder.onstop = () => {
        void handleStop()
      }
      recorder.start()
      setStatus('recording')
      startTimeRef.current = Date.now()
      elapsedTimerRef.current = setInterval(() => {
        if (startTimeRef.current !== null) setElapsed((Date.now() - startTimeRef.current!) / 1000)
      }, 100)
    } catch (err) {
      const info = getRecordingErrorInfo(err)
      setErrorInfo(info)
      setStatus('error')
      cleanup()
    }
  }, [part, cleanup, handleStop])

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current
    if (rec && (rec as unknown as { state?: string }).state === 'recording') {
      try {
        rec.stop()
      } catch {
        void handleStop()
      }
    } else {
      void handleStop()
    }
  }, [handleStop])

  const handleMismatchChoice = useCallback(
    async (choice: 'speed' | 'extend' | 'keep' | 'discard' | 'slow', shift: boolean) => {
      if (!showMismatch) return
      const { recordedDuration, base64, metadata, blobType } = showMismatch
      if (choice === 'discard') {
        setShowMismatch(null)
        cleanup()
        onClose()
        return
      }
      if (choice === 'speed' || choice === 'slow') {
        const rate = computePlaybackRate(plannedDuration, recordedDuration)
        await commitRecording(base64, metadata, blobType, rate)
        setShowMismatch(null)
        return
      }
      if (choice === 'extend' || choice === 'keep') {
        if (part?.audioClipId) {
          try {
            dispatch(new DeleteAudioClipCommand({ slideId, clipId: part.audioClipId }))
          } catch {
            /* ignore */
          }
        }
        const assetMime = blobType.startsWith('audio/') ? blobType : 'audio/wav'
        const assetResult = dispatch(
          new CreateAudioAssetCommand({
            name: `Recording ${partText.slice(0, 20)}`,
            data: base64,
            mimeType: assetMime,
            metadata: {
              duration: metadata.duration,
              sampleRate: metadata.sampleRate,
              channels: metadata.channels,
              ...(metadata.waveformPeaks ? { waveformPeaks: metadata.waveformPeaks } : {}),
            },
          }),
        )
        if (!assetResult.ok) {
          setErrorInfo({
            kind: 'unknown',
            message: assetResult.error.message,
            hint: 'Failed to create asset',
            retryable: true,
          })
          setShowMismatch(null)
          return
        }
        const assetId = (assetResult.inverse as { assetId: string }).assetId
        const clipResult = dispatch(
          new CreateAudioClipCommand({
            slideId,
            assetId,
            trackId: 'voice',
            timelineStart: partStartTime,
            sourceEnd: metadata.duration,
            playbackRate: 1,
          }),
        )
        if (!clipResult.ok) {
          setErrorInfo({
            kind: 'unknown',
            message: clipResult.error.message,
            hint: 'Failed to create clip',
            retryable: true,
          })
          setShowMismatch(null)
          return
        }
        const clipId = (clipResult.inverse as { clipId: string }).clipId
        dispatch(
          new SetPrompterPartAudioCommand({
            slideId,
            partId,
            audioClipId: clipId,
            audioAssetId: assetId,
          }),
        )
        const shiftResult = dispatch(
          new UpdatePrompterPartWithShiftCommand({
            slideId,
            partId,
            duration: recordedDuration,
            shiftDownstream: shift,
          }),
        )
        if (!shiftResult.ok) {
          setErrorInfo({
            kind: 'unknown',
            message: shiftResult.error.message,
            hint: 'Failed to update duration',
            retryable: true,
          })
          setShowMismatch(null)
          return
        }
        setShowMismatch(null)
        cleanup()
        onClose()
        return
      }
    },
    [
      showMismatch,
      plannedDuration,
      commitRecording,
      dispatch,
      slideId,
      partId,
      partText,
      partStartTime,
      part,
      cleanup,
      onClose,
    ],
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return
      if (e.key.toLowerCase() !== shortcut) return
      if (showMismatch) return
      e.preventDefault()
      if (status === 'idle' || status === 'error') void startRecording()
      else if (status === 'recording') stopRecording()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcut, status, showMismatch, startRecording, stopRecording])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup()
        onClose()
      }
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [cleanup, onClose])

  if (showMismatch) {
    const kind = getMismatchKind(
      showMismatch.recordedDuration,
      plannedDuration,
      getPrompterMismatchThreshold(engine.project?.settings ?? {}),
    )
    return (
      <MismatchDialog
        plannedDuration={plannedDuration}
        recordedDuration={showMismatch.recordedDuration}
        kind={kind}
        trackId="voice"
        onChoice={handleMismatchChoice}
        onClose={() => {
          setShowMismatch(null)
          cleanup()
          onClose()
        }}
      />
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Record"
      data-testid="record-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          cleanup()
          onClose()
        }
      }}
    >
      <div
        style={{
          background: '#2a2a2a',
          border: '1px solid #444',
          borderRadius: 8,
          width: 460,
          padding: 16,
          color: '#e0e0e0',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>● Record — &quot;{partText}&quot;</h3>
        <p style={{ fontSize: 11, color: '#888', margin: '0 0 8px' }}>
          Part {partStartTime.toFixed(1)}–{(partStartTime + plannedDuration).toFixed(1)} · Voice
          track · Shortcut{' '}
          <code style={{ background: '#333', padding: '1px 4px', borderRadius: 3 }}>
            {shortcut.toUpperCase()}
          </code>
        </p>
        <div
          style={{
            fontSize: 11,
            color: '#aaa',
            marginBottom: 8,
            padding: 8,
            background: '#1e1e1e',
            borderRadius: 4,
            border: '1px solid #333',
          }}
        >
          Text (read-only): {partText}
        </div>
        <div
          data-testid="record-meter"
          aria-label="Level meter"
          style={{
            height: 48,
            background: '#111',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '0 8px',
            margin: '8px 0',
            overflow: 'hidden',
          }}
        >
          {Array.from({ length: 24 }).map((_, i) => {
            const active = status === 'recording' && level * 24 > i
            const jitter = (i * 7) % 6
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: active ? `${6 + level * 32 + jitter}px` : '4px',
                  background: active
                    ? level > 0.7
                      ? '#ff4d4d'
                      : level > 0.4
                        ? '#7c5cff'
                        : '#333'
                    : '#222',
                  borderRadius: 2,
                  transition: 'height 0.08s, background 0.08s',
                }}
              />
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: '#888' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{elapsed.toFixed(1)}s</span>
          <span>AnalyserNode live level</span>
          {status === 'recording' && <span style={{ color: '#ff4d4d' }}>● Recording</span>}
          {status === 'requesting' && <span>Requesting microphone…</span>}
          {status === 'processing' && <span>Processing…</span>}
        </div>
        {errorInfo && (
          <div
            data-testid="record-error"
            style={{
              marginTop: 8,
              padding: 8,
              background: '#3a1a1a',
              border: '1px solid #5a2222',
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            <div style={{ color: '#ff6b6b', fontWeight: 600 }}>{errorInfo.message}</div>
            <div style={{ color: '#ccc', marginTop: 4 }}>{errorInfo.hint}</div>
            {(errorInfo.kind === 'notAllowed' || errorInfo.kind === 'notFound') && (
              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                <button
                  data-testid="record-retry"
                  onClick={() => void startRecording()}
                  style={{
                    padding: '4px 8px',
                    background: '#7c5cff',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
                {errorInfo.kind === 'notAllowed' && (
                  <span style={{ fontSize: 10, color: '#aaa' }}>
                    Check system settings → Privacy → Microphone
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            data-testid="record-cancel"
            onClick={() => {
              cleanup()
              onClose()
            }}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#333',
              color: '#e0e0e0',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          {status === 'idle' || status === 'error' ? (
            <button
              data-testid="record-start"
              onClick={() => void startRecording()}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                border: '1px solid #7c5cff',
                background: '#7c5cff',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Start (R)
            </button>
          ) : status === 'recording' ? (
            <button
              data-testid="record-stop"
              onClick={stopRecording}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                border: '1px solid #c0392b',
                background: '#c0392b',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              ■ Stop
            </button>
          ) : (
            <button
              disabled
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                border: '1px solid #444',
                background: '#333',
                color: '#888',
              }}
            >
              Processing…
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
