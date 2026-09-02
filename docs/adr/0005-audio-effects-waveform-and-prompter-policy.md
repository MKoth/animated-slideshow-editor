# ADR 0005 — Non-Destructive Audio Effects, Waveform Editor, and Prompter Length Policy

Date: 2026-09-02
Status: Accepted (grill #13-items)

Context: AudioClip today is immutable asset placement with sourceStart/sourceEnd trim; no pitch/noise; no waveform edit UI; prompt parts and clips share time axis. Request to pitch-shift, de-noise, trim any interval (including middle delete), see waveform, and handle derived duration mismatch (stretch vs cut prompt).

Decision: AudioAsset stays immutable. AudioClip gains non-destructive params: pitchSemitones -12..+12, noiseReduction 0..1, playbackRate; sourceStart/sourceEnd still defines kept contiguous interval, but Waveform Editor modal supports middle-interval delete by splitting into two AudioClips (gap-free; timeline reflects two clips) and edge trims by adjusting source bounds. Modal edits all params plus split/trim and auditions via Web Audio OfflineAudioContext preview; only on Save does it commit Transactions. Bake (rubberband pitch+rate, de-noise) is export-only via server FFmpeg, never rewriting asset. If derived duration after effects differs from PrompterPart.duration, Save shows blocking dialog: [Stretch Audio (rubberband to fit) | Trim/Split PrompterPart | Shift Downstream (reflow)] — mirrors UpdatePrompterPartWithShift but for audio-driven change. Same flow for TTS and recorded assets.

Alternatives: Destructive derived asset per edit (rejected: asset explosion, loses undo); always auto-stretch or always reflow (rejected: user must choose per mismatch); only contiguous trim without split (initially considered, rejected per user’s delete-interior need).
