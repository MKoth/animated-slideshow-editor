import { useEffect, useState } from 'react'
import { restoreProjectInEditor } from '../../app/openProjectActions'
import { clearShadow, loadRecoverableProject } from '../../app/recoveryShadow'
import type { RecoveredProject } from '../../app/recoveryShadow'
import { useEngine } from '../../app/useEngine'
import type { LessonJSON } from '../../engine'

export function RecoveryDialog() {
  const { engine } = useEngine()
  const [recovered, setRecovered] = useState<RecoveredProject | null>(null)

  useEffect(() => {
    let settled = false
    void loadRecoverableProject()
      .then((project) => {
        if (settled) {
          return
        }
        setRecovered(project)
      })
      .catch(() => {
        if (!settled) {
          setRecovered(null)
        }
      })
    return () => {
      settled = true
    }
  }, [])

  if (recovered === null) {
    return null
  }

  const restore = (): void => {
    const json = JSON.parse(recovered.json) as LessonJSON
    engine.restoreFromJSON(json)
    restoreProjectInEditor(engine)
    setRecovered(null)
  }

  const discard = (): void => {
    void clearShadow().catch(() => undefined)
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
