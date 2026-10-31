import {
  CARTESIA_EMOTIONS,
  CARTESIA_PRIMARY_EMOTIONS,
  CARTESIA_SPEED,
  CARTESIA_VOLUME,
  type CartesiaDelivery,
} from '../../engine/cartesiaControls'

interface CartesiaDeliveryControlsProps {
  value: CartesiaDelivery
  onChange: (next: CartesiaDelivery) => void
  /** testid prefix: "tts" for per-generation, "voice-prompt" for prompt form */
  testIdPrefix: string
}

const inputStyle = {
  width: '100%',
  padding: '6px 8px',
  background: '#1e1e1e',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#e0e0e0',
  marginTop: 4,
} as const

export function CartesiaDeliveryControls({
  value,
  onChange,
  testIdPrefix,
}: CartesiaDeliveryControlsProps) {
  const speedAuto = value.speed === null
  const volumeAuto = value.volume === null
  return (
    <div
      data-testid={`${testIdPrefix}-delivery`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 11, color: '#aaa' }}>
        Delivery (Cartesia) — Auto omits the field so Cartesia infers it from context.
      </div>
      <label style={{ fontSize: 11 }}>
        Emotion
        <select
          data-testid={`${testIdPrefix}-emotion`}
          value={value.emotion}
          onChange={(e) => onChange({ ...value, emotion: e.target.value })}
          style={inputStyle}
        >
          <option value="">— Auto (infer from text) —</option>
          <optgroup label="Primary">
            {CARTESIA_PRIMARY_EMOTIONS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </optgroup>
          <optgroup label="All">
            {CARTESIA_EMOTIONS.filter(
              (e) => !(CARTESIA_PRIMARY_EMOTIONS as readonly string[]).includes(e),
            ).map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            data-testid={`${testIdPrefix}-speed-auto`}
            type="checkbox"
            checked={speedAuto}
            onChange={(e) => onChange({ ...value, speed: e.target.checked ? null : 1.0 })}
          />
          Speed {speedAuto ? '(Auto)' : (value.speed as number).toFixed(2)}{' '}
          <span style={{ color: '#888' }}>
            ({CARTESIA_SPEED.min}–{CARTESIA_SPEED.max})
          </span>
        </span>
        <input
          data-testid={`${testIdPrefix}-speed`}
          type="range"
          min={CARTESIA_SPEED.min}
          max={CARTESIA_SPEED.max}
          step={CARTESIA_SPEED.step}
          value={value.speed ?? 1.0}
          disabled={speedAuto}
          onChange={(e) => onChange({ ...value, speed: parseFloat(e.target.value) })}
        />
      </label>
      <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            data-testid={`${testIdPrefix}-volume-auto`}
            type="checkbox"
            checked={volumeAuto}
            onChange={(e) => onChange({ ...value, volume: e.target.checked ? null : 1.0 })}
          />
          Volume {volumeAuto ? '(Auto)' : (value.volume as number).toFixed(2)}{' '}
          <span style={{ color: '#888' }}>
            ({CARTESIA_VOLUME.min}–{CARTESIA_VOLUME.max})
          </span>
        </span>
        <input
          data-testid={`${testIdPrefix}-volume`}
          type="range"
          min={CARTESIA_VOLUME.min}
          max={CARTESIA_VOLUME.max}
          step={CARTESIA_VOLUME.step}
          value={value.volume ?? 1.0}
          disabled={volumeAuto}
          onChange={(e) => onChange({ ...value, volume: parseFloat(e.target.value) })}
        />
      </label>
    </div>
  )
}
