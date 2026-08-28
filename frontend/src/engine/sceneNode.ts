import type {
  NodeComponents,
  TextAlignment,
  TableComponent,
  TableDimension,
  ChartComponent,
  ChartType,
  VisualConfig,
} from './components'
import { validateChartType, DEFAULT_VISUAL_CONFIG } from './chartComponent'
import { meshDataFromJSON, cloneMeshData } from './mesh'
import type { Transform } from './transform'
import { IDENTITY_PIVOT } from './transform'
import type { NodeJSON } from './json'
import { requireOpacity, requireString } from './guards'
import {
  defaultMaterial,
  materialFromJSON,
  materialToJSON,
  type MaterialInstance,
} from './materialInstance'
import type { ClipInstance } from './clipInstance'
import { clipInstanceFromJSON, clipInstanceToJSON } from './clipInstance'

const TEXT_ALIGNMENTS: readonly TextAlignment[] = ['left', 'center', 'right']

export interface CachedWorldTransform {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
}

export class SceneNode {
  readonly id: string
  name: string
  parent: SceneNode | null
  readonly children: SceneNode[]
  transform: Transform
  visible: boolean
  opacity: number
  material: MaterialInstance
  readonly components: NodeComponents
  readonly clipInstances: ClipInstance[]
  _worldTransformDirty = true
  _cachedWorldTransform: CachedWorldTransform | null = null

  constructor(id: string, name: string, transform: Transform, components: NodeComponents = {}) {
    this.id = id
    this.name = name
    this.transform = transform
    this.components = freezeComponents(components)
    this.parent = null
    this.children = []
    this.visible = true
    this.opacity = 1
    this.material = defaultMaterial()
    this.clipInstances = []
  }

  markDirty(): void {
    if (!this._worldTransformDirty) {
      this._worldTransformDirty = true
      this._cachedWorldTransform = null
      for (const child of this.children) {
        child.markDirty()
      }
    }
  }

  toJSON(): NodeJSON {
    const material = materialToJSON(this.material)
    const pivot = this.transform.localPivot ?? IDENTITY_PIVOT
    const hasPivot = pivot.x !== IDENTITY_PIVOT.x || pivot.y !== IDENTITY_PIVOT.y
    return {
      id: this.id,
      name: this.name,
      parentId: this.parent ? this.parent.id : null,
      transform: {
        x: this.transform.x,
        y: this.transform.y,
        rotation: this.transform.rotation,
        scaleX: this.transform.scaleX,
        scaleY: this.transform.scaleY,
      },
      localPivot: hasPivot ? { ...pivot } : undefined,
      visible: this.visible,
      opacity: this.opacity,
      ...(material !== undefined ? { material } : {}),
      components: { ...this.components },
      ...(this.clipInstances.length > 0
        ? { clipInstances: this.clipInstances.map(clipInstanceToJSON) }
        : {}),
    }
  }

  static fromJSON(json: NodeJSON): SceneNode {
    const id = requireString(json.id, 'Node id')
    const name = requireString(json.name, 'Node name')
    const transform = requireTransform(json.transform, id)
    const localPivot = json.localPivot ? { x: json.localPivot.x, y: json.localPivot.y } : undefined
    const node = new SceneNode(
      id,
      name,
      localPivot ? { ...transform, localPivot } : transform,
      componentsFromJSON(json.components, id),
    )
    node.visible = typeof json.visible === 'boolean' ? json.visible : true
    node.opacity =
      typeof json.opacity === 'number' ? requireOpacity(json.opacity, `Node "${id}" opacity`) : 1
    node.material = materialFromJSON(json.material, id)
    if (Array.isArray(json.clipInstances)) {
      for (const clipJson of json.clipInstances) {
        node.clipInstances.push(clipInstanceFromJSON(clipJson))
      }
    }
    return node
  }
}

function requireTransform(value: unknown, nodeId: string): Transform {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Node "${nodeId}" must have a transform`)
  }
  const transform = value as Record<string, unknown>
  for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const) {
    if (typeof transform[key] !== 'number') {
      throw new Error(`Node "${nodeId}" transform.${key} must be a number`)
    }
  }
  return transform as unknown as Transform
}

function componentsFromJSON(json: unknown, nodeId: string): NodeComponents {
  if (typeof json !== 'object' || json === null) {
    throw new Error(`Node "${nodeId}" must have a components object`)
  }
  const record = json as Record<string, unknown>
  const components: {
    camera?: NodeComponents['camera']
    assetInstance?: NodeComponents['assetInstance']
    text?: NodeComponents['text']
    bone?: NodeComponents['bone']
    mesh?: NodeComponents['mesh']
    ghost?: NodeComponents['ghost']
    table?: NodeComponents['table']
    tableRow?: NodeComponents['tableRow']
    tableCell?: NodeComponents['tableCell']
    chart?: NodeComponents['chart']
  } = {}
  if (record.camera !== undefined) {
    if (!isKind(record.camera, 'camera')) {
      throw new Error(`Node "${nodeId}" has an invalid camera component`)
    }
    components.camera = { kind: 'camera' }
  }
  if (record.assetInstance !== undefined) {
    const component = record.assetInstance as Record<string, unknown>
    if (
      !isKind(component, 'assetInstance') ||
      typeof component.assetDefinitionId !== 'string' ||
      component.assetDefinitionId === ''
    ) {
      throw new Error(`Node "${nodeId}" has an invalid asset instance component`)
    }
    components.assetInstance = {
      kind: 'assetInstance',
      assetDefinitionId: component.assetDefinitionId,
    }
  }
  if (record.text !== undefined) {
    const component = record.text as Record<string, unknown>
    if (
      !isKind(component, 'text') ||
      typeof component.content !== 'string' ||
      typeof component.fontSize !== 'number'
    ) {
      throw new Error(`Node "${nodeId}" has an invalid text component`)
    }
    if (
      typeof component.alignment !== 'string' ||
      !(TEXT_ALIGNMENTS as readonly string[]).includes(component.alignment)
    ) {
      throw new Error(`Node "${nodeId}" has an invalid text alignment: "${component.alignment}"`)
    }
    components.text = {
      kind: 'text',
      content: component.content,
      fontSize: component.fontSize,
      alignment: component.alignment as TextAlignment,
    }
  }
  if (record.bone !== undefined) {
    if (!isKind(record.bone, 'bone')) {
      throw new Error(`Node "${nodeId}" has an invalid bone component`)
    }
    const boneRecord = record.bone as Record<string, unknown>
    const length = typeof boneRecord.length === 'number' ? boneRecord.length : 100
    components.bone = { kind: 'bone', length }
  }
  if (record.mesh !== undefined) {
    if (!isKind(record.mesh, 'mesh')) {
      throw new Error(`Node "${nodeId}" has an invalid mesh component`)
    }
    components.mesh = {
      kind: 'mesh',
      mesh: meshDataFromJSON((record.mesh as Record<string, unknown>).mesh),
    }
  }
  if (record.ghost !== undefined) {
    if (!isKind(record.ghost, 'ghost')) {
      throw new Error(`Node "${nodeId}" has an invalid ghost component`)
    }
    components.ghost = { kind: 'ghost' }
  }
  if (record.table !== undefined) {
    if (!isKind(record.table, 'table')) {
      throw new Error(`Node "${nodeId}" has an invalid table component`)
    }
    components.table = parseTableComponent(record.table as Record<string, unknown>, nodeId)
  }
  if (record.tableRow !== undefined) {
    if (!isKind(record.tableRow, 'tableRow')) {
      throw new Error(`Node "${nodeId}" has an invalid tableRow component`)
    }
    const rowRecord = record.tableRow as Record<string, unknown>
    components.tableRow = {
      kind: 'tableRow',
      borderColor: typeof rowRecord.borderColor === 'string' ? rowRecord.borderColor : undefined,
      background: typeof rowRecord.background === 'string' ? rowRecord.background : undefined,
    }
  }
  if (record.tableCell !== undefined) {
    if (!isKind(record.tableCell, 'tableCell')) {
      throw new Error(`Node "${nodeId}" has an invalid tableCell component`)
    }
    const cellRecord = record.tableCell as Record<string, unknown>
    components.tableCell = {
      kind: 'tableCell',
      colSpan:
        typeof cellRecord.colSpan === 'number' && Number.isFinite(cellRecord.colSpan)
          ? cellRecord.colSpan
          : 1,
      rowSpan:
        typeof cellRecord.rowSpan === 'number' && Number.isFinite(cellRecord.rowSpan)
          ? cellRecord.rowSpan
          : 1,
      borderColor: typeof cellRecord.borderColor === 'string' ? cellRecord.borderColor : undefined,
      background: typeof cellRecord.background === 'string' ? cellRecord.background : undefined,
      padding:
        typeof cellRecord.padding === 'number' && Number.isFinite(cellRecord.padding)
          ? cellRecord.padding
          : undefined,
    }
  }
  if (record.chart !== undefined) {
    if (!isKind(record.chart, 'chart')) {
      throw new Error(`Node "${nodeId}" has an invalid chart component`)
    }
    components.chart = parseChartComponent(record.chart as Record<string, unknown>, nodeId)
  }
  return components
}

export function* walkPreOrder(root: SceneNode): IterableIterator<SceneNode> {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    stack.push(...[...current.children].reverse())
    yield current
  }
}

export function detachFromParent(node: SceneNode): void {
  if (node.parent) {
    node.parent.children.splice(node.parent.children.indexOf(node), 1)
  }
}

export function wouldFormCycle(node: SceneNode, newParent: SceneNode): boolean {
  for (let cursor: SceneNode | null = newParent; cursor !== null; cursor = cursor.parent) {
    if (cursor === node) {
      return true
    }
  }
  return false
}

function isKind(value: unknown, kind: string): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === kind
}

function parseDimension(value: unknown, context: string): TableDimension {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${context} must be an object`)
  }
  const dim = value as Record<string, unknown>
  const width = dim.width
  if (width !== 'auto' && (typeof width !== 'number' || !Number.isFinite(width))) {
    throw new Error(`${context} width must be "auto" or a finite number`)
  }
  const minWidth =
    dim.minWidth !== undefined
      ? typeof dim.minWidth === 'number' && Number.isFinite(dim.minWidth)
        ? dim.minWidth
        : undefined
      : undefined
  return minWidth !== undefined ? { width, minWidth } : { width }
}

function parseTableComponent(component: Record<string, unknown>, nodeId: string): TableComponent {
  const ctx = `Node "${nodeId}" table`
  if (!Array.isArray(component.columns) || component.columns.length === 0) {
    throw new Error(`${ctx} must have a non-empty columns array`)
  }
  const columns = component.columns.map((c, i) => parseDimension(c, `${ctx}.columns[${i}]`))
  const gap =
    typeof component.gap === 'number' && Number.isFinite(component.gap) ? component.gap : 0
  const borderWidth =
    typeof component.borderWidth === 'number' && Number.isFinite(component.borderWidth)
      ? component.borderWidth
      : 1
  const borderColor = typeof component.borderColor === 'string' ? component.borderColor : '#000000'
  return {
    kind: 'table',
    columns,
    gap,
    borderWidth,
    borderColor,
  }
}

function parseChartComponent(component: Record<string, unknown>, nodeId: string): ChartComponent {
  const ctx = `Node "${nodeId}" chart`
  if (!validateChartType(component.chartType)) {
    throw new Error(`${ctx} has an invalid chart type: "${String(component.chartType)}"`)
  }
  if (typeof component.dataSourceId !== 'string') {
    throw new Error(`${ctx} must have a dataSourceId string`)
  }
  const chartType = component.chartType as ChartType
  const dataSourceId = component.dataSourceId as string
  const visualConfig = parseVisualConfig(component.visualConfig)
  const dataLabels = parseDataLabels(component.dataLabels, ctx)
  const axisMin =
    typeof component.axisMin === 'number' && Number.isFinite(component.axisMin)
      ? component.axisMin
      : undefined
  const axisMax =
    typeof component.axisMax === 'number' && Number.isFinite(component.axisMax)
      ? component.axisMax
      : undefined
  return {
    kind: 'chart',
    chartType,
    dataSourceId,
    visualConfig,
    dataLabels,
    axisMin,
    axisMax,
    _dirty: typeof component._dirty === 'boolean' ? component._dirty : false,
  }
}

function parseVisualConfig(value: unknown): VisualConfig {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_VISUAL_CONFIG, axisLabels: { ...DEFAULT_VISUAL_CONFIG.axisLabels } }
  }
  const record = value as Record<string, unknown>
  const colors = Array.isArray(record.colors)
    ? record.colors.filter((c): c is string => typeof c === 'string')
    : DEFAULT_VISUAL_CONFIG.colors
  const axisLabels =
    typeof record.axisLabels === 'object' && record.axisLabels !== null
      ? {
          x:
            typeof (record.axisLabels as Record<string, unknown>).x === 'string'
              ? ((record.axisLabels as Record<string, unknown>).x as string)
              : DEFAULT_VISUAL_CONFIG.axisLabels.x,
          y:
            typeof (record.axisLabels as Record<string, unknown>).y === 'string'
              ? ((record.axisLabels as Record<string, unknown>).y as string)
              : DEFAULT_VISUAL_CONFIG.axisLabels.y,
        }
      : DEFAULT_VISUAL_CONFIG.axisLabels
  const legendPosition = ['top', 'bottom', 'left', 'right', 'none'].includes(
    record.legendPosition as string,
  )
    ? (record.legendPosition as VisualConfig['legendPosition'])
    : DEFAULT_VISUAL_CONFIG.legendPosition
  const padding =
    typeof record.padding === 'number' && Number.isFinite(record.padding)
      ? record.padding
      : DEFAULT_VISUAL_CONFIG.padding
  const fontFamily =
    typeof record.fontFamily === 'string' ? record.fontFamily : DEFAULT_VISUAL_CONFIG.fontFamily
  const fontSize =
    typeof record.fontSize === 'number' && Number.isFinite(record.fontSize)
      ? record.fontSize
      : DEFAULT_VISUAL_CONFIG.fontSize
  return { colors, axisLabels, legendPosition, padding, fontFamily, fontSize }
}

function parseDataLabels(value: unknown, ctx: string): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const labels: string[] = []
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string' || value[i] === '') {
      throw new Error(`${ctx}.dataLabels[${i}] must be a non-empty string`)
    }
    labels.push(value[i] as string)
  }
  return labels
}

function freezeComponents(components: NodeComponents): NodeComponents {
  const frozen: NodeComponents = {
    camera: components.camera ? Object.freeze({ ...components.camera }) : undefined,
    assetInstance: components.assetInstance
      ? Object.freeze({ ...components.assetInstance })
      : undefined,
    text: components.text ? Object.freeze({ ...components.text }) : undefined,
    bone: components.bone ? Object.freeze({ ...components.bone }) : undefined,
    mesh: components.mesh
      ? Object.freeze({ kind: 'mesh' as const, mesh: cloneMeshData(components.mesh.mesh) })
      : undefined,
    ghost: components.ghost ? Object.freeze({ ...components.ghost }) : undefined,
    table: components.table
      ? Object.freeze({
          kind: 'table' as const,
          columns: components.table.columns.map((c) => Object.freeze({ ...c })),
          gap: components.table.gap,
          borderWidth: components.table.borderWidth,
          borderColor: components.table.borderColor,
        })
      : undefined,
    tableRow: components.tableRow ? Object.freeze({ ...components.tableRow }) : undefined,
    tableCell: components.tableCell ? Object.freeze({ ...components.tableCell }) : undefined,
    chart: components.chart
      ? {
          kind: 'chart' as const,
          chartType: components.chart.chartType,
          dataSourceId: components.chart.dataSourceId,
          visualConfig: Object.freeze({ ...components.chart.visualConfig }) as VisualConfig,
          dataLabels: [...components.chart.dataLabels],
          axisMin: components.chart.axisMin,
          axisMax: components.chart.axisMax,
          _dirty: components.chart._dirty,
          // NOTE: chart component is NOT frozen — _dirty must remain mutable
        }
      : undefined,
  }
  return Object.freeze(frozen)
}
