import type { MeshData } from './mesh'
import { cloneMeshData } from './mesh'
import type { DataPoint } from './dataSourceDefinition'

export type { DataPoint }

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'flowchart'

export interface VisualConfig {
  readonly colors: readonly string[]
  readonly axisLabels: { readonly x: string; readonly y: string }
  readonly legendPosition: 'top' | 'bottom' | 'left' | 'right' | 'none'
  readonly padding: number
  readonly fontFamily: string
  readonly fontSize: number
}

export interface ChartComponent {
  readonly kind: 'chart'
  readonly chartType: ChartType
  dataSourceId: string
  visualConfig: VisualConfig
  dataLabels: string[]
  axisMin?: number
  axisMax?: number
  _dirty: boolean
}

export interface CameraComponent {
  readonly kind: 'camera'
}

export interface AssetInstanceComponent {
  readonly kind: 'assetInstance'
  readonly assetDefinitionId: string
}

export type TextAlignment = 'left' | 'center' | 'right'

export interface TextComponent {
  readonly kind: 'text'
  readonly content: string
  readonly fontSize: number
  readonly alignment: TextAlignment
}

export interface BoneComponent {
  readonly kind: 'bone'
  readonly length: number
}

export interface MeshComponent {
  readonly kind: 'mesh'
  readonly mesh: MeshData
}

export interface GhostComponent {
  readonly kind: 'ghost'
}

export interface TableDimension {
  readonly width: number | 'auto'
  readonly minWidth?: number
}

export interface TableCellSpan {
  readonly colSpan: number
  readonly rowSpan: number
}

export interface TableComponent {
  readonly kind: 'table'
  readonly columns: readonly TableDimension[]
  readonly rows: readonly TableDimension[]
  readonly gap: number
  readonly cellPadding: number
  readonly borderWidth: number
  readonly borderColor: string
  readonly textWrap: 'wrap' | 'truncate'
  readonly columnMapping: Readonly<Record<number, string>>
  readonly cellSpans: Readonly<Record<string, TableCellSpan>>
}

export interface NodeComponents {
  readonly camera?: CameraComponent
  readonly assetInstance?: AssetInstanceComponent
  readonly text?: TextComponent
  readonly bone?: BoneComponent
  readonly mesh?: MeshComponent
  readonly ghost?: GhostComponent
  readonly table?: TableComponent
  readonly chart?: ChartComponent
}

export function copyComponents(components: NodeComponents): NodeComponents {
  return {
    camera: components.camera ? { ...components.camera } : undefined,
    assetInstance: components.assetInstance ? { ...components.assetInstance } : undefined,
    text: components.text ? { ...components.text } : undefined,
    bone: components.bone ? { ...components.bone } : undefined,
    mesh: components.mesh ? { kind: 'mesh', mesh: cloneMeshData(components.mesh.mesh) } : undefined,
    ghost: components.ghost ? { ...components.ghost } : undefined,
    table: components.table ? { ...components.table } : undefined,
    chart: components.chart
      ? {
          kind: 'chart' as const,
          chartType: components.chart.chartType,
          dataSourceId: components.chart.dataSourceId,
          visualConfig: { ...components.chart.visualConfig },
          dataLabels: [...components.chart.dataLabels],
          axisMin: components.chart.axisMin,
          axisMax: components.chart.axisMax,
          _dirty: components.chart._dirty,
        }
      : undefined,
  }
}
