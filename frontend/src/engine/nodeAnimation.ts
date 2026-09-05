import type { SceneNode } from './sceneNode'
import { isRecord, requireMaterialOverrideValue, requireString } from './guards'
import type { AnimationProperty } from './animationProperties'
import type { Keyframe, KeyframeValue } from './keyframe'
import { Keyframe as KeyframeModel, newKeyframeId } from './keyframe'
import { requireKeyframeInterpolation, requireKeyframeTangent, ZERO_TANGENT } from './keyframe'
import type {
  PropertyTrackJSON,
  MaterialTrackJSON,
  DataLabelTrackJSON,
  CircleTrackJSON,
  TableTrackJSON,
  VisibleTrackJSON,
  MorphTrackJSON,
  ShadowTrackJSON,
} from './json'
import type { MorphBinding } from './shape'
import { requireMorphKeyframeValue } from './shape'
import {
  requireAnimationProperty,
  requireAnimatableForNode,
  requireCircleAnimationProperty,
  requireCircleKeyframeValue,
  requireTableAnimationProperty,
  requireTableKeyframeValue,
  requireKeyframeTime,
  requireKeyframeValue,
} from './animationProperties'
import type { CircleAnimationProperty, TableAnimationProperty } from './animationProperties'
import { requireMaterialKeyframeValue } from './materialKeyframes'
import type { MaterialParameterKindOf } from './keyframeTarget'
import type { ShadowProperty } from './shadowEffect'
import { requireShadowProperty, requireShadowKeyframeValue } from './shadowEffect'

export type { MaterialParameterKindOf } from './keyframeTarget'

export class NodeAnimation {
  readonly #tracks = new Map<AnimationProperty, Keyframe[]>()
  readonly #materialTracks = new Map<string, Keyframe[]>()
  readonly #dataLabelTracks = new Map<string, Keyframe[]>()
  readonly #circleTracks = new Map<CircleAnimationProperty, Keyframe[]>()
  readonly #tableTracks = new Map<TableAnimationProperty, Keyframe[]>()
  readonly #visible: Keyframe[] = []
  #morphBinding: MorphBinding | null = null
  readonly #morph: Keyframe[] = []
  readonly #shadowTracks = new Map<ShadowProperty, Keyframe[]>()

  keyframes(property: AnimationProperty): readonly Keyframe[] {
    return this.#tracks.get(property) ?? []
  }

  hasTrack(property: AnimationProperty): boolean {
    return this.#tracks.has(property)
  }

  materialKeyframes(parameter: string): readonly Keyframe[] {
    return this.#materialTracks.get(parameter) ?? []
  }

  hasMaterialTrack(parameter: string): boolean {
    return this.#materialTracks.has(parameter)
  }

  materialTrackParameterKeys(): string[] {
    return [...this.#materialTracks.keys()]
  }

  dataLabelKeyframes(label: string): readonly Keyframe[] {
    return this.#dataLabelTracks.get(label) ?? []
  }

  hasDataLabelTrack(label: string): boolean {
    return this.#dataLabelTracks.has(label)
  }

  dataLabelTrackLabels(): string[] {
    return [...this.#dataLabelTracks.keys()]
  }

  circleKeyframes(property: CircleAnimationProperty): readonly Keyframe[] {
    return this.#circleTracks.get(property) ?? []
  }

  hasCircleTrack(property: CircleAnimationProperty): boolean {
    return this.#circleTracks.has(property)
  }

  circleTrackKeys(): CircleAnimationProperty[] {
    return [...this.#circleTracks.keys()] as CircleAnimationProperty[]
  }

  tableKeyframes(property: TableAnimationProperty): readonly Keyframe[] {
    return this.#tableTracks.get(property) ?? []
  }

  hasTableTrack(property: TableAnimationProperty): boolean {
    return this.#tableTracks.has(property)
  }

  tableTrackKeys(): TableAnimationProperty[] {
    return [...this.#tableTracks.keys()] as TableAnimationProperty[]
  }

  shadowKeyframes(property: ShadowProperty): readonly Keyframe[] {
    return this.#shadowTracks.get(property) ?? []
  }

  hasShadowTrack(property: ShadowProperty): boolean {
    return this.#shadowTracks.has(property)
  }

  shadowTrackKeys(): ShadowProperty[] {
    return [...this.#shadowTracks.keys()] as ShadowProperty[]
  }

  addShadow(property: ShadowProperty, keyframe: Keyframe): void {
    insertSorted(this.#shadowTracks as Map<string, Keyframe[]>, property, keyframe)
  }

  removeShadow(property: ShadowProperty, keyframeId: string): Keyframe | undefined {
    return removeById(this.#shadowTracks as Map<string, Keyframe[]>, property, keyframeId)
  }

  getShadow(property: ShadowProperty, keyframeId: string): Keyframe | undefined {
    return this.#shadowTracks.get(property)?.find((entry) => entry.id === keyframeId)
  }

  removeShadowTrack(property: ShadowProperty): void {
    this.#shadowTracks.delete(property)
  }

  clearShadowTracks(): ShadowTrackJSON[] {
    const snapshot = this.shadowTracksJSON()
    this.#shadowTracks.clear()
    return snapshot
  }

  restoreShadowTracks(tracks: readonly ShadowTrackJSON[], duration: number, _nodeId: string): void {
    void _nodeId
    this.#shadowTracks.clear()
    for (const track of tracks as unknown as readonly { property: string; keyframes: readonly import('./json').KeyframeJSON[] }[]) {
      // Use tolerant read but with strict ids preserved
      const prop = track.property as ShadowProperty
      try {
        // Validate property
        requireShadowProperty(prop)
      } catch {
        continue
      }
      for (const kfJson of track.keyframes) {
        try {
          const id = kfJson.id
          const time = kfJson.time
          const value = requireShadowKeyframeValue(prop, kfJson.value, `Shadow track "${prop}"`)
          const interpolation = kfJson.interpolation ?? 'linear'
          const tangentIn = kfJson.tangentIn ?? { time: 0, value: 0 }
          const tangentOut = kfJson.tangentOut ?? { time: 0, value: 0 }
          // Validate time within duration
          if (typeof time !== 'number' || time < 0 || time > duration) continue
          const kf = new KeyframeModel(id, time, value as unknown as import('./keyframe').KeyframeValue, interpolation as import('./keyframe').InterpolationType, tangentIn as import('./keyframe').KeyframeTangent, tangentOut as import('./keyframe').KeyframeTangent)
          this.addShadow(prop, kf)
        } catch {
          continue
        }
      }
    }
  }

  visibleKeyframes(): readonly Keyframe[] {
    return this.#visible
  }

  hasVisibleTrack(): boolean {
    return this.#visible.length > 0
  }

  addVisible(keyframe: Keyframe): void {
    const index = this.#visible.findIndex((entry) => entry.time > keyframe.time)
    if (index === -1) {
      this.#visible.push(keyframe)
    } else {
      this.#visible.splice(index, 0, keyframe)
    }
  }

  removeVisible(keyframeId: string): Keyframe | undefined {
    const index = this.#visible.findIndex((entry) => entry.id === keyframeId)
    if (index === -1) {
      return undefined
    }
    const [removed] = this.#visible.splice(index, 1)
    return removed
  }

  getVisible(keyframeId: string): Keyframe | undefined {
    return this.#visible.find((entry) => entry.id === keyframeId)
  }

  // --- Morph binding & coefficient track (Spec 281, migrated to per-keyframe pair in morph rework) ---
  /** @deprecated legacy global binding — retained only for JSON migration; new code uses per-keyframe MorphKeyframeValue */
  get morphBinding(): MorphBinding | null {
    return this.#morphBinding
  }

  /** @deprecated */
  setMorphBinding(binding: MorphBinding | null): void {
    if (binding === null) {
      this.#morphBinding = null
      return
    }
    // allow both nullable, but if provided must be object with nullable ids
    this.#morphBinding = {
      fromShapeId: binding.fromShapeId,
      toShapeId: binding.toShapeId,
    }
  }

  morphKeyframes(): readonly Keyframe[] {
    return this.#morph
  }

  hasMorphTrack(): boolean {
    return this.#morph.length > 0
  }

  addMorph(keyframe: Keyframe): void {
    const index = this.#morph.findIndex((entry) => entry.time > keyframe.time)
    if (index === -1) {
      this.#morph.push(keyframe)
    } else {
      this.#morph.splice(index, 0, keyframe)
    }
  }

  removeMorph(keyframeId: string): Keyframe | undefined {
    const index = this.#morph.findIndex((entry) => entry.id === keyframeId)
    if (index === -1) {
      return undefined
    }
    const [removed] = this.#morph.splice(index, 1)
    return removed
  }

  getMorph(keyframeId: string): Keyframe | undefined {
    return this.#morph.find((entry) => entry.id === keyframeId)
  }

  add(property: AnimationProperty, keyframe: Keyframe): void {
    insertSorted(this.#tracks, property, keyframe)
  }

  addMaterial(parameter: string, keyframe: Keyframe): void {
    insertSorted(this.#materialTracks, parameter, keyframe)
  }

  addDataLabel(label: string, keyframe: Keyframe): void {
    insertSorted(this.#dataLabelTracks, label, keyframe)
  }

  addCircle(property: CircleAnimationProperty, keyframe: Keyframe): void {
    insertSorted(this.#circleTracks as Map<string, Keyframe[]>, property, keyframe)
  }

  addTable(property: TableAnimationProperty, keyframe: Keyframe): void {
    insertSorted(this.#tableTracks as Map<string, Keyframe[]>, property, keyframe)
  }

  remove(property: AnimationProperty, keyframeId: string): Keyframe | undefined {
    return removeById(this.#tracks, property, keyframeId)
  }

  removeMaterial(parameter: string, keyframeId: string): Keyframe | undefined {
    return removeById(this.#materialTracks, parameter, keyframeId)
  }

  removeDataLabel(label: string, keyframeId: string): Keyframe | undefined {
    return removeById(this.#dataLabelTracks, label, keyframeId)
  }

  removeDataLabelTrack(label: string): void {
    this.#dataLabelTracks.delete(label)
  }

  removeCircle(property: CircleAnimationProperty, keyframeId: string): Keyframe | undefined {
    return removeById(this.#circleTracks as Map<string, Keyframe[]>, property, keyframeId)
  }

  removeTable(property: TableAnimationProperty, keyframeId: string): Keyframe | undefined {
    return removeById(this.#tableTracks as Map<string, Keyframe[]>, property, keyframeId)
  }

  get(property: AnimationProperty, keyframeId: string): Keyframe | undefined {
    return this.#tracks.get(property)?.find((entry) => entry.id === keyframeId)
  }

  getMaterial(parameter: string, keyframeId: string): Keyframe | undefined {
    return this.#materialTracks.get(parameter)?.find((entry) => entry.id === keyframeId)
  }

  getDataLabel(label: string, keyframeId: string): Keyframe | undefined {
    return this.#dataLabelTracks.get(label)?.find((entry) => entry.id === keyframeId)
  }

  getCircle(property: CircleAnimationProperty, keyframeId: string): Keyframe | undefined {
    return this.#circleTracks.get(property)?.find((entry) => entry.id === keyframeId)
  }

  getTable(property: TableAnimationProperty, keyframeId: string): Keyframe | undefined {
    return this.#tableTracks.get(property)?.find((entry) => entry.id === keyframeId)
  }

  copy(): NodeAnimation {
    const copy = new NodeAnimation()
    for (const [property, keyframes] of this.#tracks) {
      copy.#tracks.set(
        property,
        keyframes.map((keyframe) => copyKeyframe(keyframe)),
      )
    }
    for (const [parameter, keyframes] of this.#materialTracks) {
      copy.#materialTracks.set(
        parameter,
        keyframes.map((keyframe) => copyKeyframe(keyframe)),
      )
    }
    for (const [label, keyframes] of this.#dataLabelTracks) {
      copy.#dataLabelTracks.set(
        label,
        keyframes.map((keyframe) => copyKeyframe(keyframe)),
      )
    }
    for (const [property, keyframes] of this.#circleTracks) {
      copy.#circleTracks.set(
        property,
        keyframes.map((keyframe) => copyKeyframe(keyframe)),
      )
    }
    for (const [property, keyframes] of this.#tableTracks) {
      copy.#tableTracks.set(
        property,
        keyframes.map((keyframe) => copyKeyframe(keyframe)),
      )
    }
    for (const [property, keyframes] of this.#shadowTracks) {
      copy.#shadowTracks.set(
        property,
        keyframes.map((keyframe) => copyKeyframe(keyframe)),
      )
    }
    for (const keyframe of this.#visible) {
      copy.#visible.push(copyKeyframe(keyframe))
    }
    for (const keyframe of this.#morph) {
      copy.#morph.push(copyKeyframe(keyframe))
    }
    if (this.#morphBinding) {
      copy.#morphBinding = { ...this.#morphBinding }
    }
    return copy
  }

  toJSON(): PropertyTrackJSON[] {
    const tracks: PropertyTrackJSON[] = []
    for (const [property, keyframes] of this.#tracks) {
      tracks.push({ property, keyframes: keyframes.map((keyframe) => keyframe.toJSON()) })
    }
    return tracks
  }

  materialTracksJSON(): MaterialTrackJSON[] {
    const tracks: MaterialTrackJSON[] = []
    for (const [parameter, keyframes] of this.#materialTracks) {
      tracks.push({ parameter, keyframes: keyframes.map((keyframe) => keyframe.toJSON()) })
    }
    return tracks
  }

  dataLabelTracksJSON(): DataLabelTrackJSON[] {
    const tracks: DataLabelTrackJSON[] = []
    for (const [label, keyframes] of this.#dataLabelTracks) {
      tracks.push({ label, keyframes: keyframes.map((keyframe) => keyframe.toJSON()) })
    }
    return tracks
  }

  circleTracksJSON(): CircleTrackJSON[] {
    const tracks: CircleTrackJSON[] = []
    for (const [property, keyframes] of this.#circleTracks) {
      tracks.push({ property, keyframes: keyframes.map((keyframe) => keyframe.toJSON()) })
    }
    return tracks
  }

  tableTracksJSON(): TableTrackJSON[] {
    const tracks: TableTrackJSON[] = []
    for (const [property, keyframes] of this.#tableTracks) {
      tracks.push({ property, keyframes: keyframes.map((keyframe) => keyframe.toJSON()) })
    }
    return tracks
  }

  shadowTracksJSON(): ShadowTrackJSON[] {
    const tracks: ShadowTrackJSON[] = []
    for (const [property, keyframes] of this.#shadowTracks) {
      tracks.push({ property, keyframes: keyframes.map((keyframe) => keyframe.toJSON()) })
    }
    return tracks
  }

  visibleTrackJSON(): VisibleTrackJSON | undefined {
    if (this.#visible.length === 0) {
      return undefined
    }
    return { keyframes: this.#visible.map((keyframe) => keyframe.toJSON()) }
  }

  morphTrackJSON(): MorphTrackJSON | undefined {
    if (this.#morph.length === 0) {
      return undefined
    }
    return { keyframes: this.#morph.map((keyframe) => keyframe.toJSON()) }
  }

  morphBindingJSON(): import('./json').MorphBindingJSON | null | undefined {
    // No longer persisted — per-keyframe pair owns the binding. Retained only for reading legacy files.
    return undefined
  }

  removeOrphanDataLabelTracks(validLabels: ReadonlySet<string>): void {
    for (const label of this.#dataLabelTracks.keys()) {
      if (!validLabels.has(label)) {
        this.#dataLabelTracks.delete(label)
      }
    }
  }

  static fromJSON(
    json: unknown,
    duration: number,
    node: SceneNode,
    parameterKindOf: MaterialParameterKindOf = () => undefined,
  ): NodeAnimation {
    const animation = new NodeAnimation()
    if (!isRecord(json) || !Array.isArray(json.tracks)) {
      throw new Error('Node animation must have a tracks array')
    }
    for (const track of json.tracks) {
      if (typeof track !== 'object' || track === null) {
        throw new Error(`Node "${node.id}" animation track must be an object`)
      }
      const record = track as Record<string, unknown>
      const property = requireAnimationProperty(record.property)
      requireAnimatableForNode(node, property)
      if (!Array.isArray(record.keyframes)) {
        throw new Error(`Track "${property}" must have a keyframes array`)
      }
      const parse = trackKeyframeParser(`Track "${property}"`, duration, (value, what) =>
        requireKeyframeValue(property, value, what),
      )
      for (const keyframeJson of record.keyframes) {
        animation.add(property, parse(keyframeJson))
      }
    }
    const materialTracks = json.materialTracks
    if (materialTracks !== undefined) {
      if (!Array.isArray(materialTracks)) {
        throw new Error('Node animation materialTracks must be an array')
      }
      for (const track of materialTracks) {
        readMaterialTrack(animation, track, duration, node, parameterKindOf)
      }
    }
    const dataLabelTracks = json.dataLabelTracks
    if (dataLabelTracks !== undefined) {
      if (!Array.isArray(dataLabelTracks)) {
        throw new Error('Node animation dataLabelTracks must be an array')
      }
      for (const track of dataLabelTracks) {
        readDataLabelTrack(animation, track, duration)
      }
    }
    const circleTracks = (json as Record<string, unknown>).circleTracks
    if (circleTracks !== undefined) {
      if (!Array.isArray(circleTracks)) {
        throw new Error('Node animation circleTracks must be an array')
      }
      for (const track of circleTracks) {
        readCircleTrack(animation, track, duration, node)
      }
    }
    const tableTracks = (json as Record<string, unknown>).tableTracks
    if (tableTracks !== undefined) {
      if (!Array.isArray(tableTracks)) {
        throw new Error('Node animation tableTracks must be an array')
      }
      for (const track of tableTracks) {
        readTableTrack(animation, track, duration, node)
      }
    }
    const visibleTrack = (json as Record<string, unknown>).visibleTrack
    if (visibleTrack !== undefined) {
      readVisibleTrack(animation, visibleTrack, duration)
    }
    let legacyBinding: MorphBinding | null = null
    const morphBinding = (json as Record<string, unknown>).morphBinding
    if (morphBinding !== undefined && morphBinding !== null) {
      legacyBinding = readMorphBinding(morphBinding)
      animation.setMorphBinding(legacyBinding)
    }
    const morphTrack = (json as Record<string, unknown>).morphTrack
    if (morphTrack !== undefined) {
      readMorphTrack(animation, morphTrack, duration, legacyBinding)
    }
    const shadowTracks = (json as Record<string, unknown>).shadowTracks
    if (shadowTracks !== undefined) {
      if (!Array.isArray(shadowTracks)) {
        console.warn(`[shadow] Node "${node.id}" shadowTracks must be an array — ignoring`)
      } else {
        for (const track of shadowTracks) {
          readShadowTrack(animation, track, duration, node.id)
        }
      }
    }
    return animation
  }
}

function readMaterialTrack(
  animation: NodeAnimation,
  track: unknown,
  duration: number,
  node: SceneNode,
  parameterKindOf: MaterialParameterKindOf,
): void {
  if (typeof track !== 'object' || track === null) {
    throw new Error(`Node "${node.id}" material track must be an object`)
  }
  const record = track as Record<string, unknown>
  const parameter = requireMaterialParameterKey(record.parameter)
  if (!Array.isArray(record.keyframes)) {
    throw new Error(`Material track "${parameter}" must have a keyframes array`)
  }
  const kind = parameterKindOf(node, parameter)
  const parse = trackKeyframeParser(`Material track "${parameter}"`, duration, (value, what) =>
    kind === undefined
      ? requireMaterialOverrideValue(value, what)
      : requireMaterialKeyframeValue(kind, value, what),
  )
  for (const keyframeJson of record.keyframes) {
    animation.addMaterial(parameter, parse(keyframeJson))
  }
}

function requireMaterialParameterKey(value: unknown): string {
  return requireString(value, 'Material parameter key')
}

function readDataLabelTrack(animation: NodeAnimation, track: unknown, duration: number): void {
  if (typeof track !== 'object' || track === null) {
    throw new Error('Data label track must be an object')
  }
  const record = track as Record<string, unknown>
  const label = requireString(record.label, 'Data label track label')
  if (!Array.isArray(record.keyframes)) {
    throw new Error(`Data label track "${label}" must have a keyframes array`)
  }
  const parse = trackKeyframeParser(`Data label track "${label}"`, duration, (value, what) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${what} must be a finite number`)
    }
    return value
  })
  for (const keyframeJson of record.keyframes) {
    animation.addDataLabel(label, parse(keyframeJson))
  }
}

function readCircleTrack(
  animation: NodeAnimation,
  track: unknown,
  duration: number,
  node: SceneNode,
): void {
  if (typeof track !== 'object' || track === null) {
    throw new Error(`Circle track must be an object`)
  }
  const record = track as Record<string, unknown>
  const property = requireCircleAnimationProperty(record.property)
  if (!node.components.circle) {
    throw new Error(
      `Node "${node.id}" does not have a circle component for circle track "${property}"`,
    )
  }
  if (!Array.isArray(record.keyframes)) {
    throw new Error(`Circle track "${property}" must have a keyframes array`)
  }
  const parse = trackKeyframeParser(`Circle track "${property}"`, duration, (value, what) =>
    requireCircleKeyframeValue(property, value, what),
  )
  for (const keyframeJson of record.keyframes) {
    animation.addCircle(property, parse(keyframeJson))
  }
}

function readTableTrack(
  animation: NodeAnimation,
  track: unknown,
  duration: number,
  node: SceneNode,
): void {
  if (typeof track !== 'object' || track === null) {
    throw new Error(`Table track must be an object`)
  }
  const record = track as Record<string, unknown>
  const property = requireTableAnimationProperty(record.property)
  if (!node.components.table && !node.components.tableCell && !node.components.tableRow) {
    throw new Error(
      `Node "${node.id}" does not have a table, row, or cell component for table track "${property}"`,
    )
  }
  if (!Array.isArray(record.keyframes)) {
    throw new Error(`Table track "${property}" must have a keyframes array`)
  }
  const parse = trackKeyframeParser(`Table track "${property}"`, duration, (value, what) =>
    requireTableKeyframeValue(property, value, what),
  )
  for (const keyframeJson of record.keyframes) {
    animation.addTable(property, parse(keyframeJson))
  }
}

function readVisibleTrack(animation: NodeAnimation, track: unknown, duration: number): void {
  if (typeof track !== 'object' || track === null) {
    throw new Error('Visible track must be an object')
  }
  const record = track as Record<string, unknown>
  if (!Array.isArray(record.keyframes)) {
    throw new Error('Visible track must have a keyframes array')
  }
  const parse = trackKeyframeParser('Visible track', duration, (value, what) => {
    if (typeof value !== 'boolean') {
      throw new Error(`${what} must be a boolean`)
    }
    return value
  })
  for (const keyframeJson of record.keyframes) {
    const keyframe = parse(keyframeJson)
    if (keyframe.interpolation !== 'hold') {
      throw new Error(`Visible track keyframe "${keyframe.id}" interpolation must be "hold"`)
    }
    animation.addVisible(keyframe)
  }
}

function readMorphBinding(json: unknown): MorphBinding | null {
  if (json === null) {
    return null
  }
  if (typeof json !== 'object' || json === null) {
    throw new Error('Morph binding must be an object')
  }
  const record = json as Record<string, unknown>
  const fromShapeId = record.fromShapeId
  const toShapeId = record.toShapeId
  if (fromShapeId !== null && typeof fromShapeId !== 'string') {
    throw new Error('Morph binding fromShapeId must be string or null')
  }
  if (toShapeId !== null && typeof toShapeId !== 'string') {
    throw new Error('Morph binding toShapeId must be string or null')
  }
  return {
    fromShapeId: fromShapeId as string | null,
    toShapeId: toShapeId as string | null,
  }
}

function readMorphTrack(
  animation: NodeAnimation,
  track: unknown,
  duration: number,
  legacyBinding: MorphBinding | null,
): void {
  if (typeof track !== 'object' || track === null) {
    throw new Error('Morph track must be an object')
  }
  const record = track as Record<string, unknown>
  if (!Array.isArray(record.keyframes)) {
    throw new Error('Morph track must have a keyframes array')
  }
  const parse = trackKeyframeParser('Morph track', duration, (value, what) => {
    // Legacy scalar support: number 0..1 → migrate to object with legacy binding
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${what} must be a number between 0 and 1`)
      }
      return {
        fromShapeId: legacyBinding?.fromShapeId ?? null,
        toShapeId: legacyBinding?.toShapeId ?? null,
        coefficient: value,
      } as import('./shape').MorphKeyframeValue
    }
    return requireMorphKeyframeValue(value, what)
  })
  for (const keyframeJson of record.keyframes) {
    animation.addMorph(parse(keyframeJson))
  }
}

function readShadowTrack(
  animation: NodeAnimation,
  track: unknown,
  duration: number,
  nodeId: string,
): void {
  if (typeof track !== 'object' || track === null) {
    console.warn(`[shadow] Node "${nodeId}" shadow track must be an object — ignoring`)
    return
  }
  const record = track as Record<string, unknown>
  let property: import('./shadowEffect').ShadowProperty
  try {
    property = requireShadowProperty(record.property)
  } catch (e) {
    console.warn(
      `[shadow] Node "${nodeId}" shadow track bad property "${String(record.property)}" — ignoring track: ${e instanceof Error ? e.message : String(e)}`,
    )
    return
  }
  if (!Array.isArray(record.keyframes)) {
    console.warn(`[shadow] Node "${nodeId}" shadow track "${property}" must have a keyframes array — ignoring`)
    return
  }
  const parse = trackKeyframeParser(`Shadow track "${property}"`, duration, (value, what) => {
    try {
      return requireShadowKeyframeValue(property, value, what) as import('./keyframe').KeyframeValue
    } catch (e) {
      // Tolerant clamp / warn path per spec
      if (property === 'color') {
        console.warn(`[shadow] Node "${nodeId}" shadow color bad "${String(value)}" → #000000`)
        return '#000000' as import('./keyframe').KeyframeValue
      }
      if (property === 'blur') {
        const num = value as number
        if (typeof num !== 'number' || !Number.isFinite(num) || num < 0) {
          console.warn(`[shadow] Node "${nodeId}" shadow blur bad ${String(value)} → 0`)
          return 0 as import('./keyframe').KeyframeValue
        }
        if (num > 32) return 32 as import('./keyframe').KeyframeValue
        return num as import('./keyframe').KeyframeValue
      }
      if (property === 'opacity') {
        const num = value as number
        if (typeof num !== 'number' || !Number.isFinite(num)) {
          console.warn(`[shadow] Node "${nodeId}" shadow opacity bad ${String(value)} → 0.35`)
          return 0.35 as import('./keyframe').KeyframeValue
        }
        return Math.max(0, Math.min(1, num)) as import('./keyframe').KeyframeValue
      }
      // numeric others: check finite
      if (typeof value !== 'number' || !Number.isFinite(value as number)) {
        const fallback = property.startsWith('scale') ? 1 : 0
        console.warn(`[shadow] Node "${nodeId}" shadow ${property} bad ${String(value)} → ${fallback}`)
        return fallback as import('./keyframe').KeyframeValue
      }
      // if still throws, rethrow original
      throw e
    }
  })
  for (const keyframeJson of record.keyframes) {
    try {
      const kf = parse(keyframeJson)
      animation.addShadow(property, kf)
    } catch (e) {
      console.warn(
        `[shadow] Node "${nodeId}" shadow track "${property}" bad keyframe — ignoring: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
}

function insertSorted(tracks: Map<string, Keyframe[]>, key: string, keyframe: Keyframe): void {
  const existing = tracks.get(key)
  if (!existing) {
    tracks.set(key, [keyframe])
    return
  }
  const index = existing.findIndex((entry) => entry.time > keyframe.time)
  if (index === -1) {
    existing.push(keyframe)
  } else {
    existing.splice(index, 0, keyframe)
  }
}

function removeById(
  tracks: Map<string, Keyframe[]>,
  key: string,
  keyframeId: string,
): Keyframe | undefined {
  const existing = tracks.get(key)
  if (!existing) {
    return undefined
  }
  const index = existing.findIndex((entry) => entry.id === keyframeId)
  if (index === -1) {
    return undefined
  }
  const [removed] = existing.splice(index, 1)
  if (existing.length === 0) {
    tracks.delete(key)
  }
  return removed
}

function copyKeyframe(keyframe: Keyframe): Keyframe {
  let value: import('./keyframe').KeyframeValue = keyframe.value
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    value = { ...((value as unknown) as Record<string, unknown>) } as unknown as import('./keyframe').KeyframeValue
  } else if (Array.isArray(value)) {
    value = [...value] as unknown as import('./keyframe').KeyframeValue
  }
  return new KeyframeModel(
    newKeyframeId(),
    keyframe.time,
    value,
    keyframe.interpolation,
    { time: keyframe.tangentIn.time, value: keyframe.tangentIn.value },
    { time: keyframe.tangentOut.time, value: keyframe.tangentOut.value },
  )
}

function trackKeyframeParser(
  label: string,
  duration: number,
  valueOf: (value: unknown, what: string) => KeyframeValue,
): (keyframeJson: unknown) => Keyframe {
  let previousTime = -Infinity
  const seenIds = new Set<string>()
  return (keyframeJson: unknown): Keyframe => {
    if (typeof keyframeJson !== 'object' || keyframeJson === null) {
      throw new Error(`${label} keyframe must be an object`)
    }
    const record = keyframeJson as Record<string, unknown>
    const id = requireString(record.id, `${label} keyframe id`)
    if (seenIds.has(id)) {
      throw new Error(`Duplicate keyframe id: ${id}`)
    }
    seenIds.add(id)
    const time = requireKeyframeTime(record.time, duration, `Keyframe "${id}" time`)
    if (time < previousTime) {
      throw new Error(`${label} keyframe times must not decrease (out-of-order time ${time})`)
    }
    if (time === previousTime && time !== duration) {
      throw new Error(
        `${label} keyframe times must be distinct (duplicate time ${time} not at the slide duration)`,
      )
    }
    previousTime = time
    const value = valueOf(record.value, `Keyframe "${id}" value`)
    const interpolation =
      record.interpolation === undefined
        ? 'linear'
        : requireKeyframeInterpolation(record.interpolation)
    const tangentIn =
      record.tangentIn === undefined ? ZERO_TANGENT : requireKeyframeTangent(record.tangentIn)
    const tangentOut =
      record.tangentOut === undefined ? ZERO_TANGENT : requireKeyframeTangent(record.tangentOut)
    return new KeyframeModel(id, time, value, interpolation, tangentIn, tangentOut)
  }
}
