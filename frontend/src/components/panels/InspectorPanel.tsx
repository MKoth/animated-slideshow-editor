import { useEffect, useState } from 'react'
import type { WorldTransform } from '../../engine/worldTransform'
import { normalizeRotation } from '../../engine'
import {
  applyNodeField,
  applyNodeFieldAutoKey,
  applyNodeName,
  applyNodeOpacity,
  applyNodeOpacityAutoKey,
  applySemanticName,
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
import {
  selectedKeyframeRefs,
  selectedMaterialKeyframeRefs,
  selectedMorphKeyframeRefs,
} from '../../app/keyframeSelectionActions'
import { selectedClipKeyframeRefs } from '../../app/clipKeyframeActions'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import type { EnginePublic, SceneNode } from '../../engine'
import type { AnimationProperty } from '../../engine'
import { useNotificationStore } from '../../stores/notificationStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useTimelineSelectionStore } from '../../stores/timelineSelectionStore'
import { useUiStore } from '../../stores/uiStore'
import { useClipLibraryStore } from '../../stores/clipLibraryStore'
import { renameSlide, setSlideDuration } from '../../app/slideActions'
import type { Slide } from '../../engine'
import { NameField, NumericField } from './inspectorFields'
import { MaterialInspectorSection } from './MaterialInspectorSection'
import { FullscreenShaderInspectorSection } from './FullscreenShaderInspectorSection'
import { AnimationsInspectorSection } from './AnimationsInspectorSection'
import { KeyframeInspector } from './KeyframeInspector'
import { MeshGenerationSection } from './MeshGenerationSection'
import { MeshInspectorSection } from './MeshInspectorSection'
import { TableInspectorSection, TableCellMultiInspector } from './TableInspectorSection'
import { ChartInspectorSection } from './ChartInspectorSection'
import { TextInspectorSection, TextMultiInspector } from './TextInspectorSection'
import { CircleInspectorSection } from './CircleInspectorSection'
import { TextureInspectorSection } from './TextureInspectorSection'
import { PROPERTY_LABELS } from './timelineTracks'
import {
  RenameClipCommand,
  SetClipDurationCommand,
  SetClipCategoryCommand,
} from '../../engine/commands'

const COMING_SOON_SECTIONS = ['Anchors', 'Physics', 'AI Metadata']

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
  const editingContext = useTimelineSelectionStore((state) => state.editingContext)
  const clipEditId = useClipLibraryStore((state) => state.selectedId)
  const timelineSelectionVersion = useTimelineSelectionStore(
    (state) => state.selections[state.editingContext],
  )
  void timelineSelectionVersion
  const [, setTick] = useState(0)
  const [nameError, setNameError] = useState<{ msg: string; targets: string } | null>(null)
  useEngineEvent(() => {
    setTick((tick) => tick + 1)
    setNameError(null)
  })

  const targets = inspectedTargets(engine, selectedIds)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNameError(null)
  }, [selectedIds.join(',')])
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
    if (editingContext === 'clip-edit' && clipEditId) {
      const clip = engine.clips.find((c) => c.id === clipEditId)
      if (clip) {
        const clipKeyframeRefs = selectedClipKeyframeRefs(engine)
        return (
          <div className="inspector-panel" style={{ width }}>
            <div className="inspector-scroll">
              <ClipEditInspectorSection
                clip={clip}
                dispatch={dispatch}
                notify={notify}
                playing={playing}
              />
              {clipKeyframeRefs.length === 1 &&
                (() => {
                  const ref = clipKeyframeRefs[0]
                  const keyframes = engine.getClipChannelKeyframes(ref.clipId, ref.channel)
                  const keyframe = keyframes.find((kf) => kf.id === ref.keyframeId)
                  if (!keyframe) {
                    return null
                  }
                  return (
                    <KeyframeInspector
                      dispatch={dispatch}
                      clipTarget={{ clipId: ref.clipId, channel: ref.channel }}
                      keyframe={keyframe}
                      playing={playing}
                      notify={notify}
                    />
                  )
                })()}
            </div>
          </div>
        )
      }
    }
    const propertyRefs = selectedKeyframeRefs(engine)
    const materialRefs = selectedMaterialKeyframeRefs(engine)
    const morphRefs = selectedMorphKeyframeRefs(engine)
    const totalSelected = propertyRefs.length + materialRefs.length + morphRefs.length
    if (totalSelected === 1) {
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
            {(() => {
              if (propertyRefs.length === 1) {
                const ref = propertyRefs[0]
                const keyframes = engine.getKeyframes(ref.nodeId, ref.property as AnimationProperty)
                const keyframe = keyframes.find((kf) => kf.id === ref.keyframeId)
                if (!keyframe) {
                  return null
                }
                return (
                  <KeyframeInspector
                    dispatch={dispatch}
                    nodeId={ref.nodeId}
                    property={ref.property}
                    keyframe={keyframe}
                    playing={playing}
                    notify={notify}
                  />
                )
              }
              if (morphRefs.length === 1) {
                const ref = morphRefs[0]
                const keyframes = engine.getMorphKeyframes(ref.nodeId)
                const keyframe = keyframes.find((kf) => kf.id === ref.keyframeId)
                if (!keyframe) return null
                return (
                  <KeyframeInspector
                    dispatch={dispatch}
                    morphNodeId={ref.nodeId}
                    keyframe={keyframe}
                    playing={playing}
                    notify={notify}
                  />
                )
              }
              const ref = materialRefs[0]
              const keyframes = engine.getMaterialKeyframes(ref.nodeId, ref.parameter)
              const keyframe = keyframes.find((kf) => kf.id === ref.keyframeId)
              if (!keyframe) {
                return null
              }
              return (
                <KeyframeInspector
                  dispatch={dispatch}
                  nodeId={ref.nodeId}
                  parameter={ref.parameter}
                  keyframe={keyframe}
                  playing={playing}
                  notify={notify}
                />
              )
            })()}
          </div>
        </div>
      )
    }
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
  const commonSemanticName = commonValueOf(targets, (node) => node.semanticName ?? '')
  const semanticWarning = (() => {
    if (playing) return null
    const missing = targets.filter(
      (n) => engine.getClipInstances(n.id).length > 0 && !n.semanticName?.trim(),
    )
    if (missing.length === 0) return null
    if (targets.length === 1) {
      return `Node "${missing[0]!.name}" has a clip but no Semantic Name — export will be blocked. Set e.g. left_hand.`
    }
    const names = missing.map((n) => n.name).join(', ')
    return `${missing.length} node(s) with clips have no Semantic Name: ${names}. Set Semantic Name before exporting collection.`
  })()
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
      setNameError(null)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.toLowerCase().includes('already exists')) {
        setNameError({ msg, targets: targetIds.join(',') })
      } else {
        notify(msg)
      }
    }
  }

  const commitSemanticName = (raw: string) => {
    try {
      const result = applySemanticName(engine, dispatch, targetIds, raw)
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
          <NameField
            label="Unique Name"
            value={commonName}
            onCommit={commitName}
            disabled={playing}
            error={nameError && nameError.targets === targetIds.join(',') ? nameError.msg : null}
          />
          <NameField
            label="Semantic Name"
            value={commonSemanticName}
            onCommit={commitSemanticName}
            disabled={playing}
            placeholder="e.g. left_hand"
            error={semanticWarning}
          />
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

        {targets.length === 1 && targets[0]!.components.mesh && (
          <MeshInspectorSection
            target={targets[0]!}
            engine={engine}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {targets.length === 1 && targets[0]!.components.assetInstance && (
          <MeshGenerationSection
            target={targets[0]!}
            engine={engine}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {targets.length === 1 && targets[0]!.components.table && (
          <TableInspectorSection
            target={targets[0]!}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {targets.length === 1 && targets[0]!.components.tableRow && (
          <TableInspectorSection
            target={targets[0]!}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {targets.length === 1 && targets[0]!.components.tableCell && (
          <TableInspectorSection
            target={targets[0]!}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {targets.length === 1 && targets[0]!.components.chart && (
          <ChartInspectorSection
            target={targets[0]!}
            engine={engine}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
            animationMode={animationMode}
          />
        )}

        {targets.length === 1 && targets[0]!.components.text && (
          <TextInspectorSection
            target={targets[0]!}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {targets.length > 1 && targets.every((n) => n.components.tableCell) && (
          <TableCellMultiInspector
            targets={targets}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {targets.length > 1 && targets.every((n) => n.components.text) && (
          <TextMultiInspector
            targets={targets}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {targets.length === 1 && targets[0]!.components.circle && (
          <CircleInspectorSection
            target={targets[0]!}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {targets.length === 1 && (targets[0]!.components.mesh || targets[0]!.components.circle) && (
          <TextureInspectorSection
            target={targets[0]!}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {targets.length === 1 && engine.clips.length > 0 && (
          <AnimationsInspectorSection
            target={targets[0]!}
            engine={engine}
            dispatch={dispatch}
            notify={notify}
            playing={playing}
          />
        )}

        {(() => {
          const propertyRefs = selectedKeyframeRefs(engine)
          const materialRefs = selectedMaterialKeyframeRefs(engine)
          const morphRefs = selectedMorphKeyframeRefs(engine)
          const totalSelected = propertyRefs.length + materialRefs.length + morphRefs.length
          if (totalSelected !== 1) {
            return null
          }
          if (propertyRefs.length === 1) {
            const ref = propertyRefs[0]
            const keyframes = engine.getKeyframes(ref.nodeId, ref.property as AnimationProperty)
            const keyframe = keyframes.find((kf) => kf.id === ref.keyframeId)
            if (!keyframe) {
              return null
            }
            return (
              <KeyframeInspector
                dispatch={dispatch}
                nodeId={ref.nodeId}
                property={ref.property}
                keyframe={keyframe}
                playing={playing}
                notify={notify}
              />
            )
          }
          if (morphRefs.length === 1) {
            const ref = morphRefs[0]
            const keyframes = engine.getMorphKeyframes(ref.nodeId)
            const keyframe = keyframes.find((kf) => kf.id === ref.keyframeId)
            if (!keyframe) return null
            return (
              <KeyframeInspector
                dispatch={dispatch}
                morphNodeId={ref.nodeId}
                keyframe={keyframe}
                playing={playing}
                notify={notify}
              />
            )
          }
          const ref = materialRefs[0]
          const keyframes = engine.getMaterialKeyframes(ref.nodeId, ref.parameter)
          const keyframe = keyframes.find((kf) => kf.id === ref.keyframeId)
          if (!keyframe) {
            return null
          }
          return (
            <KeyframeInspector
              dispatch={dispatch}
              nodeId={ref.nodeId}
              parameter={ref.parameter}
              keyframe={keyframe}
              playing={playing}
              notify={notify}
            />
          )
        })()}

        {COMING_SOON_SECTIONS.map((title) => (
          <ComingSoonSection key={title} title={title} />
        ))}
      </div>
    </div>
  )
}

function ClipEditInspectorSection({
  clip,
  dispatch,
  notify,
  playing,
}: {
  clip: import('../../engine/clipDefinition').ClipDefinition
  dispatch: (
    cmd: import('../../engine/commands').Command<unknown>,
  ) => import('../../engine/commands').CommandResult<unknown>
  notify: (msg: string) => void
  playing: boolean
}) {
  const [tick, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))
  void tick

  const commitName = (raw: string) => {
    try {
      const trimmed = raw.trim()
      if (trimmed.length === 0) return
      const result = dispatch(new RenameClipCommand({ clipId: clip.id, name: trimmed }))
      if (!result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const commitDuration = (raw: string) => {
    try {
      const value = parseFiniteNumber(raw, 'Duration')
      const result = dispatch(new SetClipDurationCommand({ clipId: clip.id, duration: value }))
      if (!result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const adjustDuration = (value: number) => {
    try {
      const result = dispatch(new SetClipDurationCommand({ clipId: clip.id, duration: value }))
      if (!result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const commitCategory = (raw: string) => {
    try {
      const result = dispatch(new SetClipCategoryCommand({ clipId: clip.id, category: raw }))
      if (!result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
      <InspectorSection title="Clip">
        <NameField label="Clip Name" value={clip.name} disabled={playing} onCommit={commitName} />
        <NumericField
          label="Duration"
          value={clip.duration}
          step={0.1}
          disabled={playing}
          onCommit={commitDuration}
          onAdjust={adjustDuration}
        />
        <NameField
          label="Category"
          value={clip.category}
          disabled={playing}
          onCommit={commitCategory}
        />
      </InspectorSection>

      {clip.params.length > 0 && (
        <InspectorSection title="Parameters">
          {clip.params.map((param) => (
            <div key={param.key} className="inspector-field">
              <label className="inspector-field__label">{param.label}</label>
              <span className="inspector-field__value">{param.default}</span>
            </div>
          ))}
        </InspectorSection>
      )}

      <InspectorSection title="Channels">
        {clip.channels.map((ch) => {
          const keyframes = clip.getChannelKeyframes(ch.property)
          return (
            <div key={ch.property} className="inspector-field">
              <label className="inspector-field__label">{PROPERTY_LABELS[ch.property]}</label>
              <span className="inspector-field__value">{keyframes.length} keyframes</span>
            </div>
          )
        })}
      </InspectorSection>
    </>
  )
}
