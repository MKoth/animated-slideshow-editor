import { useState } from 'react'
import type { EnginePublic } from '../../engine'
import type { Command, CommandResult } from '../../engine/commands'
import type { SceneNode } from '../../engine/sceneNode'
import { collectMeshes } from '../../engine/riggingQueries'
import { CreateNodeCommand } from '../../engine/commands'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import { uniqueNodeName, namesInTree } from '../../engine/naming'
import { useSelectionStore } from '../../stores/selectionStore'

interface MeshListProps {
  engine: EnginePublic
  dispatch: <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>
}

function assignedBoneNames(engine: EnginePublic, meshNode: SceneNode): string[] {
  const weights = meshNode.components.mesh?.mesh.boneWeights
  if (!weights) return []
  const boneIds = new Set<string>()
  for (const vertexWeights of weights) {
    for (const w of vertexWeights) {
      boneIds.add(w.boneId)
    }
  }
  return [...boneIds].map((id) => {
    try {
      return engine.getNode(id).name
    } catch {
      return id
    }
  })
}

export function MeshList({ engine, dispatch }: MeshListProps) {
  const slide = engine.getActiveSlide()
  const selectedIds = useSelectionStore((state) => state.selectedIds)
  const [search, setSearch] = useState('')

  if (!slide) {
    return (
      <div className="rigging-section">
        <div className="panel-empty-state">
          <p>No active slide.</p>
        </div>
      </div>
    )
  }

  const meshes = collectMeshes(slide.scene.root)

  const filtered = meshes.filter((mesh) =>
    mesh.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const handleCreateMesh = () => {
    const taken = namesInTree(slide.scene.root)
    const name = uniqueNodeName(taken, 'New Mesh')
    const mesh = createDefaultRectangleMesh(100, 100)
    dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name,
        components: { mesh: { kind: 'mesh', mesh } },
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      }),
    )
  }

  const selectedMeshId = selectedIds.length === 1 ? selectedIds[0] : null
  const selectedMesh = selectedMeshId ? meshes.find((m) => m.id === selectedMeshId) : null

  return (
    <div className="rigging-section">
      <div className="rigging-toolbar">
        <div className="rigging-toolbar__row">
          <button className="rigging-toolbar__create" onClick={handleCreateMesh}>
            Create Mesh
          </button>
        </div>
        <div className="rigging-toolbar__row">
          <input
            className="rigging-toolbar__search"
            type="search"
            aria-label="Search meshes"
            placeholder="Search by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {meshes.length === 0 ? (
        <div className="panel-empty-state">
          <p>No meshes created. Create one to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-empty-state">
          <p>No meshes match your search.</p>
        </div>
      ) : (
        <ul className="rigging-list">
          {filtered.map((mesh) => {
            const boneNames = assignedBoneNames(engine, mesh)
            const vertexCount = mesh.components.mesh?.mesh.vertices.length ?? 0
            return (
              <li key={mesh.id} className="rigging-list__item">
                <button
                  className={`rigging-list__info${
                    selectedMeshId === mesh.id ? ' rigging-list__info--selected' : ''
                  }`}
                  onClick={() => useSelectionStore.getState().select(mesh.id)}
                >
                  <span className="rigging-list__name">{mesh.name}</span>
                  <span className="rigging-list__detail">{vertexCount} vertices</span>
                  {boneNames.length > 0 && (
                    <span className="rigging-list__detail">Bones: {boneNames.join(', ')}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {selectedMesh && <MeshDetailPanel engine={engine} meshNode={selectedMesh} />}
    </div>
  )
}

function MeshDetailPanel({ engine, meshNode }: { engine: EnginePublic; meshNode: SceneNode }) {
  const weights = meshNode.components.mesh?.mesh.boneWeights
  const vertexCount = meshNode.components.mesh?.mesh.vertices.length ?? 0

  const boneEntries: { boneId: string; boneName: string; avgWeight: number }[] = []
  if (weights && weights.length > 0) {
    const boneWeightSums = new Map<string, number>()
    for (const vertexWeights of weights) {
      for (const w of vertexWeights) {
        boneWeightSums.set(w.boneId, (boneWeightSums.get(w.boneId) ?? 0) + w.weight)
      }
    }
    for (const [boneId, totalWeight] of boneWeightSums) {
      const avgWeight = totalWeight / vertexCount
      let boneName = boneId
      try {
        boneName = engine.getNode(boneId).name
      } catch {
        // keep id
      }
      boneEntries.push({ boneId, boneName, avgWeight })
    }
    boneEntries.sort((a, b) => b.avgWeight - a.avgWeight)
  }

  return (
    <section className="rigging-detail" aria-label="Mesh detail">
      <header className="rigging-detail__header">
        <h3 className="rigging-detail__title">{meshNode.name}</h3>
      </header>
      <dl className="rigging-detail__fields">
        <div className="rigging-detail__field">
          <dt>Vertices</dt>
          <dd>{vertexCount}</dd>
        </div>
        <div className="rigging-detail__field">
          <dt>Faces</dt>
          <dd>{meshNode.components.mesh?.mesh.faces.length ?? 0}</dd>
        </div>
      </dl>
      {boneEntries.length > 0 && (
        <>
          <h4 className="rigging-detail__subtitle">Assigned Bones</h4>
          <dl className="rigging-detail__fields">
            {boneEntries.map((entry) => (
              <div key={entry.boneId} className="rigging-detail__field">
                <dt>{entry.boneName}</dt>
                <dd>{(entry.avgWeight * 100).toFixed(1)}%</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}
