export interface FlowchartNode {
  readonly id: string
  readonly label: string
}

export interface FlowchartEdge {
  readonly from: string
  readonly to: string
}

export interface FlowchartDataSourceDefinitionJSON {
  readonly id: string
  readonly name: string
  readonly flowchart: {
    readonly nodes: readonly { readonly id: string; readonly label: string }[]
    readonly edges: readonly { readonly from: string; readonly to: string }[]
  }
}

export class FlowchartDataSourceDefinition {
  readonly id: string
  readonly name: string
  readonly nodes: readonly FlowchartNode[]
  readonly edges: readonly FlowchartEdge[]

  constructor(
    id: string,
    name: string,
    nodes: readonly FlowchartNode[],
    edges: readonly FlowchartEdge[],
  ) {
    if (typeof id !== 'string' || id === '') {
      throw new Error('FlowchartDataSourceDefinition id must be a non-empty string')
    }
    if (typeof name !== 'string' || name === '') {
      throw new Error('FlowchartDataSourceDefinition name must be a non-empty string')
    }
    const nodeIds = new Set<string>()
    const validatedNodes: FlowchartNode[] = []
    for (const node of nodes) {
      if (typeof node.id !== 'string' || node.id === '') {
        throw new Error('Flowchart node id must be a non-empty string')
      }
      if (typeof node.label !== 'string' || node.label === '') {
        throw new Error(`Flowchart node "${node.id}" label must be a non-empty string`)
      }
      if (nodeIds.has(node.id)) {
        throw new Error(`Duplicate flowchart node id: "${node.id}"`)
      }
      nodeIds.add(node.id)
      validatedNodes.push({ id: node.id, label: node.label })
    }
    for (const edge of edges) {
      if (typeof edge.from !== 'string' || edge.from === '') {
        throw new Error('Flowchart edge from must be a non-empty string')
      }
      if (typeof edge.to !== 'string' || edge.to === '') {
        throw new Error('Flowchart edge to must be a non-empty string')
      }
      if (!nodeIds.has(edge.from)) {
        throw new Error(`Flowchart edge references unknown node: "${edge.from}"`)
      }
      if (!nodeIds.has(edge.to)) {
        throw new Error(`Flowchart edge references unknown node: "${edge.to}"`)
      }
    }
    if (hasCycle(validatedNodes, edges)) {
      throw new Error('Flowchart contains a cycle')
    }
    this.id = id
    this.name = name
    this.nodes = Object.freeze(validatedNodes)
    this.edges = Object.freeze([...edges])
    Object.freeze(this)
  }

  toJSON(): FlowchartDataSourceDefinitionJSON {
    return {
      id: this.id,
      name: this.name,
      flowchart: {
        nodes: this.nodes.map((node) => ({ id: node.id, label: node.label })),
        edges: this.edges.map((edge) => ({ from: edge.from, to: edge.to })),
      },
    }
  }

  static fromJSON(json: FlowchartDataSourceDefinitionJSON): FlowchartDataSourceDefinition {
    return new FlowchartDataSourceDefinition(
      json.id,
      json.name,
      json.flowchart.nodes.map((node) => ({ id: node.id, label: node.label })),
      json.flowchart.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    )
  }
}

function hasCycle(nodes: readonly FlowchartNode[], edges: readonly FlowchartEdge[]): boolean {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const adjacency = new Map<string, string[]>()
  for (const id of nodeIds) {
    adjacency.set(id, [])
  }
  for (const edge of edges) {
    if (edge.from !== edge.to) {
      adjacency.get(edge.from)?.push(edge.to)
    }
  }
  const visited = new Set<string>()
  const inStack = new Set<string>()
  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visited.add(nodeId)
    inStack.add(nodeId)
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (dfs(neighbor)) return true
    }
    inStack.delete(nodeId)
    return false
  }
  for (const nodeId of nodeIds) {
    if (dfs(nodeId)) return true
  }
  return false
}
