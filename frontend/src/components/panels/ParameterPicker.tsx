import { useEffect, useRef } from 'react'
import type { AnimationProperty } from '../../engine/animationProperties'
import type { AnimatableParameter } from '../../engine/animatableParameters'
import type { ClipDefinition } from '../../engine/clipDefinition'

const PROPERTY_COLORS: Record<string, string> = {
  positionX: '#4fc3f7',
  positionY: '#81c784',
  rotation: '#ffb74d',
  scaleX: '#e57373',
  scaleY: '#ba68c8',
  opacity: '#fff176',
}

interface ParameterPickerProps {
  readonly clip: ClipDefinition
  readonly parameters: readonly AnimatableParameter[]
  readonly onSelect: (property: AnimationProperty) => void
  readonly onClose: () => void
}

export function ParameterPicker({
  clip,
  parameters,
  onSelect,
  onClose,
}: ParameterPickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const standardParams = parameters.filter((p) => p.source === 'standard')
  const materialParams = parameters.filter((p) => p.source === 'material')
  const circleParams = parameters.filter((p) => p.source === 'circle')
  const dataLabelParams = parameters.filter((p) => p.source === 'dataLabel')

  return (
    <div
      ref={dialogRef}
      className="parameter-picker"
      data-testid="parameter-picker"
      style={{
        position: 'absolute',
        top: 0,
        left: '100%',
        zIndex: 200,
        minWidth: 220,
        background: 'var(--color-bg-panel)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: 4,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {standardParams.length > 0 && (
        <ParameterGroup
          label="Scene Properties"
          parameters={standardParams}
          clip={clip}
          onSelect={onSelect}
        />
      )}
      {circleParams.length > 0 && (
        <ParameterGroup
          label="Circle Properties"
          parameters={circleParams}
          clip={clip}
          onSelect={onSelect}
        />
      )}
      {dataLabelParams.length > 0 && (
        <ParameterGroup
          label="Data Labels"
          parameters={dataLabelParams}
          clip={clip}
          onSelect={onSelect}
        />
      )}
      {materialParams.length > 0 && (
        <ParameterGroup
          label="Material Parameters"
          parameters={materialParams}
          clip={clip}
          onSelect={onSelect}
        />
      )}
      {parameters.length === 0 && (
        <div style={{ padding: '8px 12px', color: 'var(--color-text-muted)', fontSize: 12 }}>
          No animatable parameters available
        </div>
      )}
    </div>
  )
}

function ParameterGroup({
  label,
  parameters,
  clip,
  onSelect,
}: {
  label: string
  parameters: readonly AnimatableParameter[]
  clip: ClipDefinition
  onSelect: (property: AnimationProperty) => void
}) {
  return (
    <div>
      <div
        style={{
          padding: '4px 8px',
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
      {parameters.map((param) => {
        const isStandard = param.source === 'standard'
        const isCircle = param.source === 'circle'
        const isDataLabel = param.source === 'dataLabel'
        const property = param.key as AnimationProperty
        const alreadyLinked = isStandard && clip.hasChannel(property)
        const clipUnsupported = isCircle || isDataLabel
        const color = PROPERTY_COLORS[property] ?? 'var(--color-text)'

        return (
          <button
            key={param.key}
            className="parameter-picker__item"
            data-testid={`parameter-picker-item-${param.key}`}
            disabled={alreadyLinked || clipUnsupported}
            title={clipUnsupported ? 'Timeline keyframes only — not a clip channel' : undefined}
            onClick={() => {
              if (!alreadyLinked && isStandard && !clipUnsupported) {
                onSelect(property)
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '5px 8px',
              border: 'none',
              background: 'transparent',
              cursor: alreadyLinked || clipUnsupported ? 'default' : 'pointer',
              opacity: alreadyLinked || clipUnsupported ? 0.4 : 1,
              textAlign: 'left',
              borderRadius: 4,
              fontSize: 12,
              color: 'var(--color-text)',
            }}
            onMouseEnter={(e) => {
              if (!alreadyLinked && !clipUnsupported) {
                e.currentTarget.style.background = 'var(--color-bg-elevated)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {isStandard && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: color,
                  flexShrink: 0,
                }}
              />
            )}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {param.label}
            </span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--color-text-muted)',
                flexShrink: 0,
              }}
            >
              {alreadyLinked ? 'Added' : clipUnsupported ? 'Timeline' : param.kind}
            </span>
          </button>
        )
      })}
    </div>
  )
}
