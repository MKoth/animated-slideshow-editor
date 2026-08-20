import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { BoneTree } from './BoneTree'
import { IKChainList } from './IKChainList'
import { ConstraintList } from './ConstraintList'
import { MeshList } from './MeshList'
import { RiggingContext } from './RiggingContext'

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

  return (
    <div className="rigging-panel">
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
