import { useState } from 'react'
import type { ReactNode } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { SetSlideAnimationScriptCommand } from '../../engine/commands'
import { HistoryPanel } from '../panels/HistoryPanel'
import { ScriptPanel } from '../panels/ScriptPanel'
import { TimelinePanel } from '../panels/TimelinePanel'

type BottomTab = 'timeline' | 'history' | 'script'

function TabButton({
  selected,
  onClick,
  testId,
  children,
}: {
  selected: boolean
  onClick: () => void
  testId: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      data-testid={testId}
      style={{
        padding: '4px 12px',
        borderRadius: 4,
        border: 'none',
        background: selected ? 'var(--color-accent)' : 'transparent',
        color: selected ? 'var(--color-accent-text)' : 'var(--color-text-muted)',
        cursor: 'pointer',
        fontSize: 11,
      }}
    >
      {children}
    </button>
  )
}

export function BottomPanel({ height }: { height: number }) {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((tick) => tick + 1))
  const [activeTab, setActiveTab] = useState<BottomTab>('timeline')

  const slide = engine.getActiveSlide()
  const script = slide?.animationScript ?? null
  const visibleTab: BottomTab =
    activeTab === 'script' && (slide === null || script === null) ? 'timeline' : activeTab

  const createScript = () => {
    if (!slide) return
    const result = dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source: '' }))
    if (result.ok) {
      setActiveTab('script')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          padding: '4px 8px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-panel)',
        }}
      >
        <TabButton
          selected={visibleTab === 'timeline'}
          onClick={() => setActiveTab('timeline')}
          testId="bottom-tab-timeline"
        >
          Timeline
        </TabButton>
        <TabButton
          selected={visibleTab === 'history'}
          onClick={() => setActiveTab('history')}
          testId="bottom-tab-history"
        >
          History
        </TabButton>
        {slide !== null && script !== null ? (
          <TabButton
            selected={visibleTab === 'script'}
            onClick={() => setActiveTab('script')}
            testId="bottom-tab-script"
          >
            Script
          </TabButton>
        ) : (
          slide !== null && (
            <button
              type="button"
              data-testid="bottom-tab-create-script"
              onClick={createScript}
              title="This slide has no Animation Script yet"
              style={{
                padding: '4px 12px',
                borderRadius: 4,
                border: '1px dashed var(--color-border)',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Create Script
            </button>
          )
        )}
      </div>
      {visibleTab === 'timeline' && <TimelinePanel height={height} />}
      {visibleTab === 'history' && <HistoryPanel height={height} />}
      {visibleTab === 'script' && slide !== null && script !== null && (
        <ScriptPanel
          slideId={slide.id}
          slideName={slide.name}
          source={script.source}
          height={height}
        />
      )}
    </div>
  )
}
