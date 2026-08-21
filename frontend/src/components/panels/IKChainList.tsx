import { useState } from 'react'
import type { EnginePublic } from '../../engine'
import type { Scene } from '../../engine'
import type { Command, CommandResult } from '../../engine/commands'
import type { Slide } from '../../engine/slide'
import type { IKChain } from '../../engine/ikChain'
import { CreateIKChainCommand, DeleteIKChainCommand } from '../../engine/commands'
import { useSelectionStore } from '../../stores/selectionStore'
import { useIKSelectionStore } from '../../stores/ikSelectionStore'
import { useNotificationStore } from '../../stores/notificationStore'
import type { SceneNode } from '../../engine/sceneNode'
import { runCommand } from './sectionHelpers'

interface IKChainListProps {
  engine: EnginePublic
  dispatch: <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>
  slide: Slide
}

function boneNames(engine: EnginePublic, boneIds: readonly string[]): string {
  return boneIds
    .map((id) => {
      try {
        return engine.getNode(id).name
      } catch {
        return id
      }
    })
    .join(' → ')
}

function validateBoneChain(scene: Scene, boneIds: readonly string[]): string | null {
  if (boneIds.length < 2) {
    return 'Select at least 2 bones for an IK chain'
  }
  const nodes: SceneNode[] = []
  for (const boneId of boneIds) {
    const node = scene.getNode(boneId)
    if (!node) {
      return `Bone "${boneId}" not found`
    }
    if (!node.components.bone) {
      return `Node "${node.name}" is not a bone`
    }
    nodes.push(node)
  }
  for (let i = 0; i < nodes.length - 1; i++) {
    const parent = nodes[i]
    const child = nodes[i + 1]
    if (child.parent !== parent) {
      return `Bone "${child.name}" is not a child of "${parent.name}". Select bones in a straight parent→child line.`
    }
  }
  return null
}

function chainAlreadyExists(
  existingChains: readonly IKChain[],
  boneIds: readonly string[],
): boolean {
  return existingChains.some(
    (chain) =>
      chain.boneIds.length === boneIds.length && chain.boneIds.every((id, i) => id === boneIds[i]),
  )
}

export function IKChainList({ engine, dispatch, slide }: IKChainListProps) {
  const chains = engine.getIKManager().getChainsForSlide(slide.id)
  const [search, setSearch] = useState('')
  const notify = useNotificationStore((state) => state.notify)
  const selectedChainId = useIKSelectionStore((state) => state.selectedChainId)
  const selectChain = useIKSelectionStore((state) => state.selectChain)

  const filtered = chains.filter((_chain, index) => {
    if (!search.trim()) return true
    const name = `IK Chain ${index + 1}`
    return name.toLowerCase().includes(search.trim().toLowerCase())
  })

  const handleCreateFromSelection = () => {
    const selectedIds = useSelectionStore.getState().selectedIds
    if (selectedIds.length === 0) {
      notify('Select bones in the bone tree first')
      return
    }
    const error = validateBoneChain(slide.scene, selectedIds)
    if (error) {
      notify(error)
      return
    }
    if (chainAlreadyExists(chains, selectedIds)) {
      notify('This bone chain already has an IK chain')
      return
    }
    runCommand(notify, () =>
      dispatch(
        new CreateIKChainCommand({
          slideId: slide.id,
          boneIds: selectedIds,
          target: { position: { x: 200, y: 0 } },
        }),
      ),
    )
  }

  const handleDeleteChain = (chain: IKChain) => {
    runCommand(notify, () => dispatch(new DeleteIKChainCommand({ chainId: chain.id })))
    if (selectedChainId === chain.id) {
      selectChain(null)
    }
  }

  return (
    <div className="rigging-section">
      <div className="rigging-toolbar">
        <div className="rigging-toolbar__row">
          <button className="rigging-toolbar__create" onClick={handleCreateFromSelection}>
            Create IK Chain
          </button>
        </div>
        <div className="rigging-toolbar__row">
          <input
            className="rigging-toolbar__search"
            type="search"
            aria-label="Search IK chains"
            placeholder="Search by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {chains.length === 0 ? (
        <div className="panel-empty-state">
          <p>No IK chains. Select bones in a parent→child line, then click Create.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-empty-state">
          <p>No IK chains match your search.</p>
        </div>
      ) : (
        <ul className="rigging-list">
          {filtered.map((chain, index) => (
            <li key={chain.id} className="rigging-list__item">
              <div
                className={`rigging-list__info${selectedChainId === chain.id ? ' rigging-list__info--selected' : ''}`}
                onClick={() => selectChain(chain.id)}
              >
                <span className="rigging-list__name">IK Chain {index + 1}</span>
                <span className="rigging-list__detail">{boneNames(engine, chain.boneIds)}</span>
                <span className="rigging-list__detail">
                  Target: ({chain.target.position.x.toFixed(0)},{' '}
                  {chain.target.position.y.toFixed(0)})
                </span>
              </div>
              <div className="rigging-list__actions">
                <button
                  aria-label="Delete IK chain"
                  title="Delete IK chain"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteChain(chain)
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
