import { useState } from 'react'
import { openProjectInEditor } from '../../app/openProjectActions'
import { clearShadow, loadRecoverableProject } from '../../app/recoveryShadow'
import { useEngine } from '../../app/useEngine'
import type { Project } from '../../engine'

export function RecoveryDialog() {
  const { engine } = useEngine()
  const [recovered, setRecovered] = useState<Project | null>(loadRecoverableProject)

  if (recovered === null) {
    return null
  }

  const restore = (): void => {
    openProjectInEditor(engine, recovered)
    setRecovered(null)
  }

  const discard = (): void => {
    clearShadow()
    setRecovered(null)
  }

  return (
    <div className="recovery-dialog" role="dialog" aria-label="Recovered project">
      <p className="recovery-dialog__message">Recovered project found. Restore?</p>
      <div className="recovery-dialog__actions">
        <button className="recovery-dialog__button" onClick={restore}>
          Restore
        </button>
        <button className="recovery-dialog__button" onClick={discard}>
          Discard
        </button>
      </div>
    </div>
  )
}
