import { useState } from 'react'
import type { WorldTransform } from '../../engine/worldTransform'
import { normalizeRotation } from '../../engine'
import {
  applyNodeField,
  applyNodeFieldAutoKey,
  applyNodeName,
  applyNodeOpacity,
  applyNodeOpacityAutoKey,
  commonValueOf,
  degreesOf,
  FIELD_LABELS,
  FIELD_PROPERTY,
  parseFiniteNumber,
  readEvaluatedNodeWorld,
  readStoredNodeWorld,
  resetNodesTransform,
  resetNodesTransformAutoKey,
} from '../../app/inspectorActions'
import type { InspectorFieldKind } from '../../app/inspectorActions'
import type { PropertyState } from '../../app/keyframeActions'
import { playheadTimeOf, propertyStateOf } from '../../app/keyframeActions'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import type { EnginePublic, SceneNode } from '../../engine'
import type { AnimationProperty } from '../../engine'
import { useNotificationStore } from '../../stores/notificationStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useUiStore } from '../../stores/uiStore'
import { renameSlide, setSlideDuration } from '../../app/slideActions'
import type { Slide } from '../../engine'
import { NameField, NumericField } from './inspectorFields'
import { MaterialInspectorSection } from './MaterialInspectorSection'
import { FullscreenShaderInspectorSection } from './FullscreenShaderInspectorSection'

const COMING_SOON_SECTIONS = ['Animation', 'Anchors', 'Physics', 'AI Metadata']

function isRenderableNode(node: SceneNode): boolean {
  return Boolean(node.components.assetInstance || node.components.text)
}

function inspectedTargets(engine: EnginePublic, selectedIds: readonly string[]): SceneNode[] {
  const activeSlide = engine.getActiveSlide()
  if (!activeSlide) {
    return []
  }
  const activeScene = activeSlide.scene
  const targets: SceneNode[] = []
  for (const nodeId of selectedIds) {
    try {
      const node = engine.getNode(nodeId)
      if (activeScene.getNode(nodeId)) {
        targets.push(node)
      }
    } catch {
      // the id is stale (node deleted); skip it
    }
  }
  return targets
}

function mixedTransformField(
  readings: readonly (WorldTransform | null)[],
  field: InspectorFieldKind,
): number | null {
  const firstReading = readings[0]
  if (!firstReading) {
    return null
  }
  const comparable = (reading: WorldTransform): number =>
    field === 'rotation' ? normalizeRotation(reading.rotation) : reading[field]
  const first = comparable(firstReading)
  for (const reading of readings) {
    if (!reading || comparable(reading) !== first) {
      return null
    }
  }
  return field === 'rotation' ? degreesOf(firstReading) : first
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">{title}</h3>
      {children}
    </section>
  )
}

function SlideSection({
  slide,
  playing,
  onCommitName,
  onCommitDuration,
  onAdjustDuration,
}: {
  slide: Slide
  playing: boolean
  onCommitName: (raw: string) => void
  onCommitDuration: (raw: string) => void
  onAdjustDuration: (value: number) => void
}) {
  return (
    <InspectorSection title="Slide">
      <NameField label="Slide Name" value={slide.name} disabled={playing} onCommit={onCommitName} />
      <NumericField
        label="Duration"
        value={slide.duration}
        step={0.1}
        disabled={playing}
        onCommit={onCommitDuration}
        onAdjust={onAdjustDuration}
      />
    </InspectorSection>
  )
}

function ComingSoonSection({ title }: { title: string }) {
  return (
    <section className="inspector-section inspector-section--coming-soon">
      <h3 className="inspector-section__title">{title}</h3>
      <p className="inspector-section__notice">Coming in future versions.</p>
    </section>
  )
}

export function InspectorPanel({ width }: { width: number }) {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((state) => state.notify)
  const selectedIds = useSelectionStore((state) => state.selectedIds)
  const animationMode = useUiStore((state) => state.animationMode)
  const cameraAnimationMode = useUiStore((state) => state.cameraAnimationMode)
  usePlaybackController((state) => state.currentTimes)
  const playing = usePlaybackController((state) => state.status === 'playing')
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((tick) => tick + 1))

  const targets = inspectedTargets(engine, selectedIds)
  const slide = engine.getActiveSlide()
  const cameraSelected = targets.length === 1 && Boolean(targets[0]?.components.camera)
  const animatingCamera = cameraAnimationMode && cameraSelected
  const transformAutoKey = animationMode || animatingCamera
  const opacityAutoKey = animationMode
  const evaluatedDisplay = transformAutoKey || playing
  const modeActions = {
    readWorld: evaluatedDisplay ? readEvaluatedNodeWorld : readStoredNodeWorld,
    opacityOf: evaluatedDisplay
      ? (node: SceneNode) =>
          engine.evaluateNode(node.id, playheadTimeOf(engine, node.id) ?? 0).opacity
      : (node: SceneNode) => node.opacity,
    applyField: transformAutoKey ? applyNodeFieldAutoKey : applyNodeField,
    applyOpacity: opacityAutoKey ? applyNodeOpacityAutoKey : applyNodeOpacity,
    resetTransform: transformAutoKey ? resetNodesTransformAutoKey : resetNodesTransform,
  }
  const readTarget = targets.length > 0 ? modeActions.readWorld(engine, targets[0].id) : null

  const commitSlideName = (raw: string) => {
    if (!slide) {
      return
    }
    try {
      renameSlide(engine, dispatch, slide.id, raw, notify)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const commitSlideDuration = (raw: string) => {
    if (!slide) {
      return
    }
    try {
      const value = parseFiniteNumber(raw, 'Duration')
      setSlideDuration(engine, dispatch, slide.id, value, notify)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const adjustSlideDuration = (value: number) => {
    if (!slide) {
      return
    }
    setSlideDuration(engine, dispatch, slide.id, value, notify)
  }

  if (targets.length === 0 || !readTarget) {
    if (!slide) {
      return (
        <div className="inspector-panel" style={{ width }}>
          <div className="panel-empty-state">
            <p>Nothing selected. Select an object to edit its properties.</p>
          </div>
        </div>
      )
    }
    return (
      <div className="inspector-panel" style={{ width }}>
        <div className="inspector-scroll">
          <SlideSection
            slide={slide}
            playing={playing}
            onCommitName={commitSlideName}
            onCommitDuration={commitSlideDuration}
            onAdjustDuration={adjustSlideDuration}
          />
          <FullscreenShaderInspectorSection
            slide={slide}
            engine={engine}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
          <div className="panel-empty-state">
            <p>Nothing selected. Select an object to edit its properties.</p>
          </div>
        </div>
      </div>
    )
  }

  const multi = targets.length > 1
  const targetIds = targets.map((node) => node.id)
  const cameraTarget = targets.some((node) => Boolean(node.components.camera))
  const world = readTarget.world
  const indicatorTime = playheadTimeOf(engine, targets[0].id) ?? 0
  const indicatorOf = (field: InspectorFieldKind): PropertyState | null =>
    propertyStateOf(engine, targets[0].id, FIELD_PROPERTY[field], indicatorTime)
  const opacityIndicator = propertyStateOf(engine, targets[0].id, 'opacity', indicatorTime)
  const commonName = commonValueOf(targets, (node) => node.name)
  const commonOpacity = commonValueOf(targets, modeActions.opacityOf)
  const transformReadings = targets.map(
    (node) => modeActions.readWorld(engine, node.id)?.world ?? null,
  )
  const opacityPercent = commonOpacity === null ? null : Math.round(commonOpacity * 100)
  const animatedPropertyOf = (property: AnimationProperty): boolean =>
    targets.some((node) => engine.getKeyframes(node.id, property).length > 0)
  const fieldDisabledOf = (field: InspectorFieldKind): boolean =>
    playing || (!transformAutoKey && animatedPropertyOf(FIELD_PROPERTY[field]))
  const opacityDisabled = playing || (!opacityAutoKey && animatedPropertyOf('opacity'))

  const commitField = (field: InspectorFieldKind, raw: string) => {
    try {
      const value = parseFiniteNumber(raw, FIELD_LABELS[field])
      const result = modeActions.applyField(engine, dispatch, targetIds, field, value)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const adjustField = (field: InspectorFieldKind, value: number) => {
    try {
      const result = modeActions.applyField(engine, dispatch, targetIds, field, value)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const commitName = (raw: string) => {
    try {
      const result = applyNodeName(engine, dispatch, targetIds, raw)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const commitOpacity = (raw: string) => {
    try {
      const percent = parseFiniteNumber(raw, 'Opacity')
      const result = modeActions.applyOpacity(engine, dispatch, targetIds, percent / 100)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const adjustOpacity = (percent: number) => {
    try {
      const result = modeActions.applyOpacity(engine, dispatch, targetIds, percent / 100)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const handleResetTransform = () => {
    const result = modeActions.resetTransform(engine, dispatch, targetIds)
    if (result && !result.ok) {
      notify(result.error.message)
    }
  }

  return (
    <div className="inspector-panel" style={{ width }}>
      <div className="inspector-scroll">
        {slide && (
          <SlideSection
            slide={slide}
            playing={playing}
            onCommitName={commitSlideName}
            onCommitDuration={commitSlideDuration}
            onAdjustDuration={adjustSlideDuration}
          />
        )}

        {slide && (
          <FullscreenShaderInspectorSection
            slide={slide}
            engine={engine}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        <InspectorSection title={multi ? `${targets.length} Objects Selected` : 'General'}>
          <NameField value={commonName} onCommit={commitName} disabled={playing} />
        </InspectorSection>

        <InspectorSection title="Transform">
          <NumericField
            label="X"
            value={multi ? mixedTransformField(transformReadings, 'x') : world.x}
            step={1}
            disabled={fieldDisabledOf('x')}
            state={indicatorOf('x')}
            onCommit={(raw) => commitField('x', raw)}
            onAdjust={(value) => adjustField('x', value)}
          />
          <NumericField
            label="Y"
            value={multi ? mixedTransformField(transformReadings, 'y') : world.y}
            step={1}
            disabled={fieldDisabledOf('y')}
            state={indicatorOf('y')}
            onCommit={(raw) => commitField('y', raw)}
            onAdjust={(value) => adjustField('y', value)}
          />
          <NumericField
            label="Rotation"
            value={multi ? mixedTransformField(transformReadings, 'rotation') : degreesOf(world)}
            step={1}
            disabled={cameraTarget || fieldDisabledOf('rotation')}
            state={indicatorOf('rotation')}
            onCommit={(raw) => commitField('rotation', raw)}
            onAdjust={(value) => adjustField('rotation', value)}
          />
          <NumericField
            label="Scale X"
            value={multi ? mixedTransformField(transformReadings, 'scaleX') : world.scaleX}
            step={0.01}
            disabled={fieldDisabledOf('scaleX')}
            state={indicatorOf('scaleX')}
            onCommit={(raw) => commitField('scaleX', raw)}
            onAdjust={(value) => adjustField('scaleX', value)}
          />
          <NumericField
            label="Scale Y"
            value={multi ? mixedTransformField(transformReadings, 'scaleY') : world.scaleY}
            step={0.01}
            disabled={fieldDisabledOf('scaleY')}
            state={indicatorOf('scaleY')}
            onCommit={(raw) => commitField('scaleY', raw)}
            onAdjust={(value) => adjustField('scaleY', value)}
          />
          <button className="inspector-reset" onClick={handleResetTransform} disabled={playing}>
            Reset Transform
          </button>
        </InspectorSection>

        <InspectorSection title="Appearance">
          <NumericField
            label="Opacity"
            value={opacityPercent}
            step={1}
            disabled={opacityDisabled}
            state={opacityIndicator}
            onCommit={commitOpacity}
            onAdjust={adjustOpacity}
          />
        </InspectorSection>

        {targets.length > 0 && targets.every(isRenderableNode) && (
          <MaterialInspectorSection
            targets={targets}
            engine={engine}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
            animationMode={animationMode}
            playheadTime={indicatorTime}
          />
        )}

        {COMING_SOON_SECTIONS.map((title) => (
          <ComingSoonSection key={title} title={title} />
        ))}
      </div>
    </div>
  )
}
