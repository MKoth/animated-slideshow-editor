import type { EnginePublic } from '../../engine'
import { useSelectionStore } from '../../stores/selectionStore'

interface RiggingContextProps {
  engine: EnginePublic
}

export function RiggingContext({ engine }: RiggingContextProps) {
  const selectedIds = useSelectionStore((state) => state.selectedIds)
  const selectedNodeId = selectedIds.length === 1 ? selectedIds[0] : null

  if (!selectedNodeId) {
    return null
  }

  let node
  try {
    node = engine.getNode(selectedNodeId)
  } catch {
    return null
  }

  const isBone = !!node.components.bone
  const isMesh = !!node.components.mesh

  if (!isBone && !isMesh) {
    return null
  }

  return (
    <section className="rigging-context" aria-label="Selection context">
      <header className="rigging-context__header">
        <h3 className="rigging-context__title">{node.name}</h3>
        <span className="rigging-context__badge">{isBone ? 'Bone' : 'Mesh'}</span>
      </header>
      {isBone && <BoneContext engine={engine} nodeId={node.id} />}
      {isMesh && <MeshContext engine={engine} nodeId={node.id} />}
    </section>
  )
}

function BoneContext({ engine, nodeId }: { engine: EnginePublic; nodeId: string }) {
  const ikChains = engine.getIKManager().getChainsForBone(nodeId)
  const constraints = engine.getConstraintManager().getConstraintsForNode(nodeId)

  return (
    <div className="rigging-context__body">
      {ikChains.length > 0 && (
        <>
          <h4 className="rigging-context__subtitle">IK Chains</h4>
          <ul className="rigging-context__list">
            {ikChains.map((chain) => (
              <li key={chain.id} className="rigging-context__list-item">
                IK Chain ({chain.boneIds.length} bones)
              </li>
            ))}
          </ul>
        </>
      )}
      {constraints.length > 0 && (
        <>
          <h4 className="rigging-context__subtitle">Constraints</h4>
          <ul className="rigging-context__list">
            {constraints.map((constraint) => (
              <li key={constraint.id} className="rigging-context__list-item">
                {constraint.type} (priority {constraint.priority})
              </li>
            ))}
          </ul>
        </>
      )}
      {ikChains.length === 0 && constraints.length === 0 && (
        <p className="rigging-context__empty">No IK chains or constraints on this bone.</p>
      )}
    </div>
  )
}

function MeshContext({ engine, nodeId }: { engine: EnginePublic; nodeId: string }) {
  const node = engine.getNode(nodeId)
  const weights = node.components.mesh?.mesh.boneWeights

  const boneEntries: { boneName: string; avgWeight: number }[] = []
  if (weights && weights.length > 0) {
    const boneWeightSums = new Map<string, number>()
    for (const vertexWeights of weights) {
      for (const w of vertexWeights) {
        boneWeightSums.set(w.boneId, (boneWeightSums.get(w.boneId) ?? 0) + w.weight)
      }
    }
    const vertexCount = node.components.mesh!.mesh.vertices.length
    for (const [boneId, totalWeight] of boneWeightSums) {
      const avgWeight = totalWeight / vertexCount
      let boneName = boneId
      try {
        boneName = engine.getNode(boneId).name
      } catch {
        // keep id
      }
      boneEntries.push({ boneName, avgWeight })
    }
    boneEntries.sort((a, b) => b.avgWeight - a.avgWeight)
  }

  return (
    <div className="rigging-context__body">
      {boneEntries.length > 0 ? (
        <>
          <h4 className="rigging-context__subtitle">Assigned Bones</h4>
          <dl className="rigging-context__fields">
            {boneEntries.map((entry) => (
              <div key={entry.boneName} className="rigging-context__field">
                <dt>{entry.boneName}</dt>
                <dd>{(entry.avgWeight * 100).toFixed(1)}%</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="rigging-context__empty">No bone weights assigned to this mesh.</p>
      )}
    </div>
  )
}
