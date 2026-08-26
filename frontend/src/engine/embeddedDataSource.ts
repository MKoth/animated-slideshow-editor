export interface EmbeddedDataSourceBase {
  readonly id: string
  readonly name: string
}

export interface EmbeddedDataPoint {
  readonly label: string
  readonly value: number
  readonly series?: string
  readonly tooltip?: string
  readonly color?: string
}

export interface EmbeddedDataSourceDefinition extends EmbeddedDataSourceBase {
  readonly dataPoints: readonly EmbeddedDataPoint[]
}

export interface EmbeddedFlowchartNode {
  readonly id: string
  readonly label: string
}

export interface EmbeddedFlowchartEdge {
  readonly from: string
  readonly to: string
}

export interface EmbeddedFlowchartDataSourceDefinition extends EmbeddedDataSourceBase {
  readonly nodes: readonly EmbeddedFlowchartNode[]
  readonly edges: readonly EmbeddedFlowchartEdge[]
}

export type EmbeddedDataSourceDefinitionUnion =
  EmbeddedDataSourceDefinition | EmbeddedFlowchartDataSourceDefinition
