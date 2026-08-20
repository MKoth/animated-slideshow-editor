import { useState } from 'react'
import type { Command, CommandResult } from '../../engine/commands'
import type { SceneNode } from '../../engine/sceneNode'
import { collectBones } from '../../engine/riggingQueries'
import { CreateNodeCommand } from '../../engine/commands'
import { uniqueNodeName, namesInTree } from '../../engine/naming'
import { useSelectionStore } from '../../stores/selectionStore'
import type { Slide } from '../../engine/slide'

interface BoneTreeProps {
  dispatch: <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>
  slide: Slide
}

interface BoneRowProps {
  node: SceneNode
  depth: number
}

function BoneRow({ node, depth }: BoneRowProps) {
  const selected = useSelectionStore((state) => state.selectedIds.includes(node.id))
  const indent = depth * 16

  return (
    <li>
      <button
        className={`rigging-tree__row${selected ? ' rigging-tree__row--selected' : ''}`}
        style={{ paddingLeft: indent + 8 }}
        onClick={() => useSelectionStore.getState().select(node.id)}
      >
        <span className="rigging-tree__icon" aria-hidden="true">
          &#x1f33f;
        </span>
        <span className="rigging-tree__name">{node.name}</span>
      </button>
      {node.children.length > 0 && (
        <ul role="group">
          {node.children.map((child) => (
            <BoneRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function BoneTree({ dispatch, slide }: BoneTreeProps) {
  const bones = collectBones(slide.scene.root)
  const [search, setSearch] = useState('')

  const filtered = bones.filter((bone) =>
    bone.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const handleCreateBone = () => {
    const taken = namesInTree(slide.scene.root)
    const name = uniqueNodeName(taken, 'New Bone')
    dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name,
        components: { bone: { kind: 'bone', length: 100 } },
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      }),
    )
  }

  return (
    <div className="rigging-section">
      <div className="rigging-toolbar">
        <div className="rigging-toolbar__row">
          <button className="rigging-toolbar__create" onClick={handleCreateBone}>
            Create Bone
          </button>
        </div>
        <div className="rigging-toolbar__row">
          <input
            className="rigging-toolbar__search"
            type="search"
            aria-label="Search bones"
            placeholder="Search by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {bones.length === 0 ? (
        <div className="panel-empty-state">
          <p>No bones created. Create one to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-empty-state">
          <p>No bones match your search.</p>
        </div>
      ) : (
        <ul className="rigging-tree" role="tree" aria-label="Bone hierarchy">
          {filtered.map((bone) => (
            <BoneRow key={bone.id} node={bone} depth={0} />
          ))}
        </ul>
      )}
    </div>
  )
}
