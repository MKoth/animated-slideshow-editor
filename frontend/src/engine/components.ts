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

export interface TableComponent {
  readonly kind: 'table'
  readonly columns: readonly TableDimension[]
  readonly gap: number
  readonly borderWidth: number
  readonly borderColor: string
}

export interface TableRowComponent {
  readonly kind: 'tableRow'
  readonly borderColor?: string
  readonly background?: string
  readonly zIndex?: number
}

export interface TableCellComponent {
  readonly kind: 'tableCell'
  readonly colSpan: number
  readonly rowSpan: number
  readonly borderColor?: string
  readonly background?: string
  readonly padding?: number
  readonly zIndex?: number
}

export interface NodeComponents {
  readonly camera?: CameraComponent
  readonly assetInstance?: AssetInstanceComponent
  readonly text?: TextComponent
  readonly bone?: BoneComponent
  readonly mesh?: MeshComponent
  readonly ghost?: GhostComponent
  readonly table?: TableComponent
  readonly tableRow?: TableRowComponent
  readonly tableCell?: TableCellComponent
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
    tableRow: components.tableRow ? { ...components.tableRow } : undefined,
    tableCell: components.tableCell ? { ...components.tableCell } : undefined,
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
