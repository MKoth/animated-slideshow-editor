// timeStretch.ts — pitch-preserving time stretching
// Uses RubberBand WASM (Daninet/rubberband-wasm) when available, falls back to
// linear resampling for tests / environments without WASM.
// timeRatio = outputDuration / inputDuration = 1 / playbackRate
//   e.g. recorded 3s -> planned 2s, playbackRate 1.5, timeRatio 0.666 (shorter, faster tempo, same pitch)

import { RubberBandInterface, RubberBandOption } from 'rubberband-wasm'
// Vite will handle ?url imports; we need wasm URL
// @ts-ignore - vite url import
import wasmUrl from 'rubberband-wasm/dist/rubberband.wasm?url'

let rubberBandPromise: Promise<RubberBandInterface> | null = null
let rubberBandInstance: RubberBandInterface | null = null

async function loadRubberBand(): Promise<RubberBandInterface | null> {
  if (rubberBandInstance) return rubberBandInstance
  if (rubberBandPromise) return rubberBandPromise
  rubberBandPromise = (async () => {
    try {
      // Fetch wasm binary
      const response = await fetch(wasmUrl as string)
      if (!response.ok) throw new Error(`fetch wasm ${response.status}`)
      const bytes = await response.arrayBuffer()
      const module = await WebAssembly.compile(bytes)
      const instance = await RubberBandInterface.initialize(module)
      rubberBandInstance = instance
      return instance
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[timeStretch] RubberBand WASM failed, falling back to linear', e)
      return null as unknown as RubberBandInterface
    }
  })()
  const res = await rubberBandPromise
  // If failed, clear promise so retry possible? Keep null
  if (!res) {
    rubberBandPromise = null
    return null
  }
  return res
}

// Exposed for tests / fallback detection
export function isRubberBandAvailable(): boolean {
  return rubberBandInstance !== null
}

// For testing: allow injecting mock
let mockStretchFn: ((buffer: AudioBuffer, timeRatio: number) => Promise<AudioBuffer>) | null = null
export function __setMockStretch(fn: typeof mockStretchFn) {
  mockStretchFn = fn
}

let mockEffectsFn: ((buffer: AudioBuffer, timeRatio: number, pitchSemitones: number, noiseReduction: number) => Promise<AudioBuffer>) | null = null
export function __setMockEffects(fn: typeof mockEffectsFn) {
  mockEffectsFn = fn
}

export function getPitchScaleForSemitones(semitones: number): number {
  return Math.pow(2, semitones / 12)
}

export function getSemitonesForPitchScale(scale: number): number {
  if (scale <= 0) throw new Error('scale must be positive')
  return 12 * Math.log2(scale)
}

export function getTimeRatioForPlaybackRate(playbackRate: number): number {
  if (playbackRate <= 0) throw new Error('playbackRate must be >0')
  return 1 / playbackRate
}

export function getPlaybackRateForTimeRatio(timeRatio: number): number {
  if (timeRatio <= 0) throw new Error('timeRatio must be >0')
  return 1 / timeRatio
}

// Linear fallback (pitch shifts like playbackRate, but duration correct)
// Used in tests / when WASM unavailable. Marked as fallback so we know it's not pitch-preserving.
function linearStretch(buffer: AudioBuffer, timeRatio: number): AudioBuffer {
  // timeRatio <1 shorter (faster), >1 longer (slower)
  if (Math.abs(timeRatio - 1) < 1e-6) return buffer
  const newLength = Math.max(1, Math.round(buffer.length * timeRatio))
  const ctxCtor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  // In tests, AudioContext may be mocked; try to create via available ctor
  let audioCtx: AudioContext | null = null
  try {
    if (ctxCtor) audioCtx = new ctxCtor()
  } catch {
    audioCtx = null
  }
  // If we have a context, createBuffer via context; otherwise try buffer's context?
  // Fallback: try to allocate via same sampleRate using OfflineAudioContext or manual
  let newBuffer: AudioBuffer
  if (audioCtx) {
    newBuffer = audioCtx.createBuffer(buffer.numberOfChannels, newLength, buffer.sampleRate)
    try { audioCtx.close() } catch { /* ignore */ }
  } else {
    // Last resort: use globalThis.OfflineAudioContext if available, otherwise craft minimal AudioBuffer-like
    // For jsdom tests, AudioBuffer may be mocked; try to use buffer's constructor?
    // Create a plain object that quacks like AudioBuffer for tests (duration, sampleRate, etc.)
    // But for real browser we need real AudioBuffer.
    // Try OfflineAudioContext
    const OfflineCtor = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
    if (OfflineCtor) {
      const offline = new OfflineCtor(buffer.numberOfChannels, newLength, buffer.sampleRate)
      newBuffer = offline.createBuffer(buffer.numberOfChannels, newLength, buffer.sampleRate)
    } else {
      // Minimal mock: will not play but tests can check duration/length
      // Create via Object.create
      newBuffer = {
        numberOfChannels: buffer.numberOfChannels,
        length: newLength,
        sampleRate: buffer.sampleRate,
        duration: newLength / buffer.sampleRate,
        getChannelData: (ch: number) => {
          // linear interpolate from old
          const oldData = buffer.getChannelData(ch)
          const out = new Float32Array(newLength)
          for (let i = 0; i < newLength; i++) {
            const oldIdx = i / timeRatio
            const low = Math.floor(oldIdx)
            const high = Math.min(oldData.length - 1, low + 1)
            const frac = oldIdx - low
            const a = oldData[low] ?? 0
            const b = oldData[high] ?? 0
            out[i] = a * (1 - frac) + b * frac
          }
          return out
        },
        copyFromChannel: (() => {}) as unknown as AudioBuffer['copyFromChannel'],
        copyToChannel: (() => {}) as unknown as AudioBuffer['copyToChannel'],
      } as unknown as AudioBuffer
      // Fill channel data for mock case already via getChannelData lazy? For mock we returned closure, need to actually fill
      // For real AudioBuffer case, we need to fill
      // Do linear fill for real case below
      if (audioCtx === null) return newBuffer
    }
  }
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const oldData = buffer.getChannelData(ch)
    const newData = newBuffer.getChannelData(ch)
    for (let i = 0; i < newLength; i++) {
      const oldIdx = i / timeRatio
      const low = Math.floor(oldIdx)
      const high = Math.min(oldData.length - 1, low + 1)
      const frac = oldIdx - low
      const a = oldData[low] ?? 0
      const b = oldData[high] ?? 0
      newData[i] = a * (1 - frac) + b * frac
    }
  }
  return newBuffer
}

async function rubberBandStretchWithPitch(buffer: AudioBuffer, timeRatio: number, pitchScale: number): Promise<AudioBuffer> {
  const rb = await loadRubberBand()
  if (!rb) {
    // fallback: time stretch only, pitch shift approximated via linear fallback (ignores formant)
    // For fallback, if pitchScale !=1 we do a naive pitch shift via resampling + time correction approx
    if (Math.abs(pitchScale - 1) > 1e-6) {
      // Simple fallback: resample by pitchScale then correct duration via linear stretch
      const pitchedLength = Math.max(1, Math.round(buffer.length / pitchScale))
      const ctxCtor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      let pitched: AudioBuffer
      if (ctxCtor) {
        let tmp: AudioContext | null = null
        try {
          tmp = new ctxCtor()
          pitched = tmp.createBuffer(buffer.numberOfChannels, pitchedLength, buffer.sampleRate)
        } catch {
          pitched = buffer
        } finally {
          if (tmp) try { tmp.close() } catch { /* ignore */ }
        }
        // naive copy with linear interpolation for pitch (changes duration)
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const src = buffer.getChannelData(ch)
          const dst = pitched.getChannelData(ch)
          for (let i = 0; i < pitchedLength; i++) {
            const srcIdx = i * pitchScale
            const low = Math.floor(srcIdx)
            const high = Math.min(src.length - 1, low + 1)
            const frac = srcIdx - low
            dst[i] = (src[low] ?? 0) * (1 - frac) + (src[high] ?? 0) * frac
          }
        }
        // then stretch pitched back to timeRatio duration
        return linearStretch(pitched, timeRatio)
      }
      return linearStretch(buffer, timeRatio)
    }
    return linearStretch(buffer, timeRatio)
  }
  const sampleRate = buffer.sampleRate
  const channels = buffer.numberOfChannels
  const inputLength = buffer.length
  if (inputLength === 0) return buffer
  // Options: offline, precise stretch, crisp transients, formant preserved, finer engine
  const options =
    RubberBandOption.RubberBandOptionProcessOffline |
    RubberBandOption.RubberBandOptionStretchPrecise |
    RubberBandOption.RubberBandOptionTransientsCrisp |
    RubberBandOption.RubberBandOptionFormantPreserved |
    RubberBandOption.RubberBandOptionEngineFiner |
    RubberBandOption.RubberBandOptionPitchHighQuality

  const state = rb.rubberband_new(sampleRate, channels, options, timeRatio, pitchScale)
  try {
    rb.rubberband_set_expected_input_duration(state, inputLength)

    // Allocate input channel buffers
    const inputPtr = rb.malloc(channels * 4)
    const inputChannelPtrs: number[] = []
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch)
      // copy to Float32Array for wasm
      const ptr = rb.malloc(data.length * 4)
      // Write Float32
      const heapBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      // Need to ensure we write as Float32 bytes; memWrite expects Uint8Array
      rb.memWrite(ptr, heapBytes)
      inputChannelPtrs.push(ptr)
      rb.memWritePtr(inputPtr + ch * 4, ptr)
    }

    // Study
    rb.rubberband_study(state, inputPtr, inputLength, 1)

    // Process
    rb.rubberband_process(state, inputPtr, inputLength, 1)

    const available = rb.rubberband_available(state)
    // Estimate output length
    const estimatedOutput = Math.ceil(inputLength * timeRatio) + 2048
    const outLength = Math.max(available, estimatedOutput)
    // Allocate output
    const outputPtr = rb.malloc(channels * 4)
    const outputChannelPtrs: number[] = []
    for (let ch = 0; ch < channels; ch++) {
      const ptr = rb.malloc(outLength * 4)
      outputChannelPtrs.push(ptr)
      rb.memWritePtr(outputPtr + ch * 4, ptr)
    }

    const retrieved = rb.rubberband_retrieve(state, outputPtr, outLength)
    const actualFrames = retrieved > 0 ? retrieved : available
    const finalLength = Math.max(1, actualFrames)

    // Create output AudioBuffer
    const ctxCtor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    let outBuffer: AudioBuffer
    if (ctxCtor) {
      const tmpCtx = new ctxCtor()
      outBuffer = tmpCtx.createBuffer(channels, finalLength, sampleRate)
      try { tmpCtx.close() } catch { /* ignore */ }
    } else {
      const OfflineCtor = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
      if (OfflineCtor) {
        const offline = new OfflineCtor(channels, finalLength, sampleRate)
        outBuffer = offline.createBuffer(channels, finalLength, sampleRate)
      } else {
        throw new Error('No AudioContext available to create stretched buffer')
      }
    }

    for (let ch = 0; ch < channels; ch++) {
      const ptr = outputChannelPtrs[ch]
      const channelData = rb.memReadF32(ptr, finalLength)
      // channelData is a view into wasm heap; copy
      const outData = outBuffer.getChannelData(ch)
      outData.set(channelData.subarray(0, finalLength))
    }

    // Free
    for (const p of inputChannelPtrs) rb.free(p)
    rb.free(inputPtr)
    for (const p of outputChannelPtrs) rb.free(p)
    rb.free(outputPtr)
    rb.rubberband_delete(state)

    return outBuffer
  } catch (e) {
    try { rb.rubberband_delete(state) } catch { /* ignore */ }
    // eslint-disable-next-line no-console
    console.warn('[timeStretch] rubberband failed, falling back', e)
    return linearStretch(buffer, timeRatio)
  }
}

async function rubberBandStretch(buffer: AudioBuffer, timeRatio: number): Promise<AudioBuffer> {
  return rubberBandStretchWithPitch(buffer, timeRatio, 1.0)
}

async function applyNoiseReductionOffline(buffer: AudioBuffer, amount: number): Promise<AudioBuffer> {
  if (amount <= 1e-6) return buffer
  if (amount < 0) amount = 0
  if (amount > 1) amount = 1
  // Try OfflineAudioContext graph first (Web Audio based, non-destructive, no asset rewrite)
  const OfflineCtor = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
  if (OfflineCtor) {
    try {
      const offline = new OfflineCtor(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
      const source = offline.createBufferSource()
      source.buffer = buffer
      // Simple denoiser chain: high-pass + compressor gate
      // Use Biquad high-pass to remove rumble, plus DynamicsCompressor as gate
      let lastNode: AudioNode = source as unknown as AudioNode
      try {
        const hp = offline.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 80 + amount * 40 // 80-120 Hz
        hp.Q.value = 0.7
        lastNode.connect(hp)
        lastNode = hp
      } catch {
        // ignore filter creation
      }
      try {
        const comp = offline.createDynamicsCompressor()
        // More aggressive when amount higher
        comp.threshold.value = -50 + amount * 10 // -50 to -40 dB
        comp.ratio.value = 4 + amount * 8 // 4 to 12
        comp.attack.value = 0.003
        comp.release.value = 0.25
        comp.knee.value = 10
        lastNode.connect(comp)
        lastNode = comp
      } catch {
        // ignore
      }
      // Add subtle low-pass for high-freq hiss when amount high
      if (amount > 0.5) {
        try {
          const lp = offline.createBiquadFilter()
          lp.type = 'lowpass'
          lp.frequency.value = 8000 - (amount - 0.5) * 6000 // 8000 -> 5000
          lp.Q.value = 0.5
          lastNode.connect(lp)
          lastNode = lp
        } catch {
          // ignore
        }
      }
      // Attenuate overall low-level based on amount via Gain
      try {
        const gain = offline.createGain()
        gain.gain.value = 1 - amount * 0.05 // slight overall reduction 0-0.05
        lastNode.connect(gain)
        lastNode = gain
      } catch {
        // ignore
      }
      lastNode.connect(offline.destination)
      source.start(0)
      const rendered = await offline.startRendering()
      return rendered
    } catch {
      // fall through to manual
    }
  }
  // Manual fallback: simple gate processing
  const ctxCtor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  let outBuffer: AudioBuffer
  if (ctxCtor) {
    try {
      const tmp = new ctxCtor()
      outBuffer = tmp.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
      try { tmp.close() } catch { /* ignore */ }
    } catch {
      return buffer
    }
  } else if (OfflineCtor) {
    const offline = new OfflineCtor(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
    outBuffer = offline.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  } else {
    return buffer
  }
  const threshold = 0.02 + amount * 0.03 // 0.02 - 0.05
  const attenuation = 1 - amount * 0.85 // 1 -> 0.15
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch)
    const dst = outBuffer.getChannelData(ch)
    for (let i = 0; i < src.length; i++) {
      const v = src[i]
      if (Math.abs(v) < threshold) dst[i] = v * attenuation
      else {
        // subtle smoothing for higher amount
        if (amount > 0.5) {
          const factor = 1 - (amount - 0.5) * 0.1
          dst[i] = v * factor
        } else dst[i] = v
      }
    }
  }
  return outBuffer
}

export async function applyAudioEffects(
  buffer: AudioBuffer,
  timeRatio: number,
  pitchSemitones: number,
  noiseReduction: number,
): Promise<AudioBuffer> {
  if (mockEffectsFn) return mockEffectsFn(buffer, timeRatio, pitchSemitones, noiseReduction)
  if (mockStretchFn && pitchSemitones === 0 && noiseReduction === 0) {
    // legacy mock for tempo only
    return mockStretchFn(buffer, timeRatio)
  }
  const hasTempo = Math.abs(timeRatio - 1) > 1e-6
  const hasPitch = Math.abs(pitchSemitones) > 1e-6
  const hasNoise = noiseReduction > 1e-6
  if (!hasTempo && !hasPitch && !hasNoise) return buffer
  let out: AudioBuffer = buffer
  const clampedTime = Math.max(0.25, Math.min(4, timeRatio))
  const pitchScale = getPitchScaleForSemitones(pitchSemitones)
  if (hasTempo || hasPitch) {
    try {
      out = await rubberBandStretchWithPitch(out, clampedTime, pitchScale)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[timeStretch] effects failed, linear fallback', e)
      out = linearStretch(out, clampedTime)
    }
  }
  if (hasNoise) {
    out = await applyNoiseReductionOffline(out, noiseReduction)
  }
  return out
}

export async function stretchAudioBuffer(buffer: AudioBuffer, timeRatio: number): Promise<AudioBuffer> {
  if (mockStretchFn) return mockStretchFn(buffer, timeRatio)
  if (Math.abs(timeRatio - 1) < 1e-6) return buffer
  // Clamp to reasonable range 0.25 - 4.0 (0.25x = 4x faster, 4x = 4x slower)
  const clamped = Math.max(0.25, Math.min(4, timeRatio))
  // Try rubberband
  try {
    return await rubberBandStretch(buffer, clamped)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[timeStretch] failed, linear fallback', e)
    return linearStretch(buffer, clamped)
  }
}

// Convenience: stretch by playbackRate
export async function stretchAudioBufferByPlaybackRate(buffer: AudioBuffer, playbackRate: number): Promise<AudioBuffer> {
  const timeRatio = getTimeRatioForPlaybackRate(playbackRate)
  return stretchAudioBuffer(buffer, timeRatio)
}

// For backend fallback: if we want to use server stretch instead of WASM for preview
export async function stretchViaBackend(base64: string, mimeType: string, playbackRate: number): Promise<{ data: string; duration: number; sampleRate: number; channels: number } | null> {
  try {
    const res = await fetch('/api/audio/stretch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64, mimeType, playbackRate }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
