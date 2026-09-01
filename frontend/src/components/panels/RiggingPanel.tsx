import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { BoneTree } from './BoneTree'
import { IKChainList } from './IKChainList'
import { ConstraintList } from './ConstraintList'
import { MeshList } from './MeshList'
import { RiggingContext } from './RiggingContext'
import { CreateRigHandleCommand } from '../../engine/commands'
import { namesInTree, uniqueNodeName } from '../../engine/naming'
import { useSelectionStore } from '../../stores/selectionStore'
import { collectBones, collectMeshes } from '../../engine/riggingQueries'

type RiggingSectionId = 'bones' | 'ik-chains' | 'constraints' | 'meshes'

const SECTIONS: readonly { id: RiggingSectionId; label: string }[] = [
  { id: 'bones', label: 'Bones' },
  { id: 'ik-chains', label: 'IK Chains' },
  { id: 'constraints', label: 'Constraints' },
  { id: 'meshes', label: 'Meshes' },
]

export function RiggingPanel() {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  const [section, setSection] = useState<RiggingSectionId>('bones')

  useEngineEvent((event) => {
    if (
      event.type === 'ProjectLoaded' ||
      event.type === 'NodeCreated' ||
      event.type === 'NodeRemoved' ||
      event.type === 'NodeRenamed' ||
      event.type === 'IKChainCreated' ||
      event.type === 'IKChainDeleted' ||
      event.type === 'ConstraintAdded' ||
      event.type === 'ConstraintRemoved' ||
      event.type === 'ConstraintChanged' ||
      event.type === 'MeshChanged'
    ) {
      setTick((t) => t + 1)
    }
  })

  const slide = engine.getActiveSlide()
  if (!slide) {
    return (
      <div className="panel-empty-state">
        <p>No active slide.</p>
      </div>
    )
  }

  const handleCreateRigHandle = () => {
    const taken = namesInTree(slide.scene.root)
    const name = uniqueNodeName(taken, 'Rig Handle')
    const selectedIds = useSelectionStore.getState().selectedIds
    let childIds: string[] = []
    if (selectedIds.length > 0) {
      // Use selected nodes that belong to this slide
      const idsInScene = new Set<string>()
      const walk = (node: import('../../engine').SceneNode) => {
        idsInScene.add(node.id)
        for (const child of node.children) walk(child)
      }
      walk(slide.scene.root)
      childIds = selectedIds.filter(
        (id) => idsInScene.has(id) && id !== slide.scene.root.id && id !== slide.scene.camera.id,
      )
      // Also include associated IK ghosts for selected bones
      const ghosts = new Set<string>()
      for (const cid of [...childIds]) {
        for (const chain of engine.getIKManager().getChainsForSlide(slide.id)) {
          if (chain.boneIds.includes(cid)) {
            if (chain.ghostNodeId) ghosts.add(chain.ghostNodeId)
            if (chain.poleGhostNodeId) ghosts.add(chain.poleGhostNodeId)
            else if (chain.poleTarget?.nodeId) ghosts.add(chain.poleTarget.nodeId)
          }
        }
      }
      for (const g of ghosts) {
        if (!childIds.includes(g) && idsInScene.has(g)) childIds.push(g)
      }
    } else {
      // No selection — group the whole rig: meshes, skeleton roots, IK handles, pole vectors
      const meshes = collectMeshes(slide.scene.root).map((n) => n.id)
      const bones = collectBones(slide.scene.root)
      const skeletonRoots = bones
        .filter((b) => b.parent && !b.parent.components.bone)
        .map((n) => n.id)
      const roots = skeletonRoots.length > 0 ? skeletonRoots : bones.slice(0, 1).map((n) => n.id)
      const ghosts: string[] = []
      for (const chain of engine.getIKManager().getChainsForSlide(slide.id)) {
        if (chain.ghostNodeId) ghosts.push(chain.ghostNodeId)
        if (chain.poleGhostNodeId) ghosts.push(chain.poleGhostNodeId)
        else if (chain.poleTarget?.nodeId) ghosts.push(chain.poleTarget.nodeId)
      }
      childIds = [...new Set([...meshes, ...roots, ...ghosts])]
      // If still empty (no rig), just create empty handle
    }
    const result = dispatch(
      new CreateRigHandleCommand({
        sceneId: slide.scene.id,
        name,
        childIds,
      }),
    )
    if (result.ok) {
      useSelectionStore.getState().select(result.inverse.handleId)
    }
  }

  return (
    <div className="rigging-panel">
      <div className="rigging-toolbar" style={{ display: 'flex', gap: '8px', padding: '8px' }}>
        <button
          className="rigging-toolbar__create"
          onClick={handleCreateRigHandle}
          title="Create empty Group/Locator (Rig Handle) and parent selected rig elements with Keep World"
          aria-label="Create Rig Handle"
        >
          Create Rig Handle
        </button>
      </div>
      <div className="rigging-sections" role="group" aria-label="Rigging sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`rigging-sections__tab${
              section === s.id ? ' rigging-sections__tab--active' : ''
            }`}
            aria-pressed={section === s.id}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="rigging-content">
        {section === 'bones' && <BoneTree dispatch={dispatch} slide={slide} />}
        {section === 'ik-chains' && (
          <IKChainList engine={engine} dispatch={dispatch} slide={slide} />
        )}
        {section === 'constraints' && <ConstraintList engine={engine} dispatch={dispatch} />}
        {section === 'meshes' && <MeshList engine={engine} dispatch={dispatch} />}
      </div>
      <RiggingContext engine={engine} />
    </div>
  )
}
