import { useState } from 'react'
import type { EnginePublic } from '../../engine'
import type { Command, CommandResult } from '../../engine/commands'
import type { Slide } from '../../engine/slide'
import type { IKChain } from '../../engine/ikChain'
import { CreateIKChainCommand, DeleteIKChainCommand } from '../../engine/commands'
import { useSelectionStore } from '../../stores/selectionStore'
import { walkPreOrder } from '../../engine/sceneNode'
import type { SceneNode } from '../../engine/sceneNode'

interface IKChainListProps {
  engine: EnginePublic
  dispatch: <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>
  slide: Slide
}

function collectBoneIds(root: SceneNode): string[] {
  const ids: string[] = []
  for (const node of walkPreOrder(root)) {
    if (node.components.bone) {
      ids.push(node.id)
    }
  }
  return ids
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

export function IKChainList({ engine, dispatch, slide }: IKChainListProps) {
  const chains = engine.getIKManager().getChainsForSlide(slide.id)
  const [search, setSearch] = useState('')

  const filtered = chains.filter((_chain, index) => {
    if (!search.trim()) return true
    const name = `IK Chain ${index + 1}`
    return name.toLowerCase().includes(search.trim().toLowerCase())
  })

  const handleCreateIKChain = () => {
    const boneIds = collectBoneIds(slide.scene.root)
    if (boneIds.length < 2) {
      return
    }
    dispatch(
      new CreateIKChainCommand({
        slideId: slide.id,
        boneIds: [boneIds[0], boneIds[1]],
        target: { position: { x: 200, y: 0 } },
      }),
    )
  }

  const handleDeleteChain = (chain: IKChain) => {
    dispatch(new DeleteIKChainCommand({ chainId: chain.id }))
  }

  return (
    <div className="rigging-section">
      <div className="rigging-toolbar">
        <div className="rigging-toolbar__row">
          <button
            className="rigging-toolbar__create"
            onClick={handleCreateIKChain}
            disabled={collectBoneIds(slide.scene.root).length < 2}
          >
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
          <p>No IK chains created. Create at least 2 bones first.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-empty-state">
          <p>No IK chains match your search.</p>
        </div>
      ) : (
        <ul className="rigging-list">
          {filtered.map((chain, index) => (
            <li key={chain.id} className="rigging-list__item">
              <div className="rigging-list__info">
                <span className="rigging-list__name">IK Chain {index + 1}</span>
                <span className="rigging-list__detail">{boneNames(engine, chain.boneIds)}</span>
                <span className="rigging-list__detail">
                  Target: ({chain.target.position.x}, {chain.target.position.y})
                </span>
              </div>
              <div className="rigging-list__actions">
                <button
                  aria-label="Select IK chain bones"
                  title="Select IK chain bones"
                  onClick={() => {
                    if (chain.boneIds.length > 0) {
                      useSelectionStore.getState().select(chain.boneIds[0])
                    }
                  }}
                >
                  Select
                </button>
                <button
                  aria-label="Delete IK chain"
                  title="Delete IK chain"
                  onClick={() => handleDeleteChain(chain)}
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
