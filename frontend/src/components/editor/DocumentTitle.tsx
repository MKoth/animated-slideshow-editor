import { useEffect, useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { usePersistenceStore } from '../../stores/persistenceStore'

const DEFAULT_TITLE = 'AI Slideshow Editor'

export function DocumentTitle() {
  const { engine } = useEngine()
  const dirty = usePersistenceStore((state) => state.dirty)
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((tick) => tick + 1))
  const project = engine.project

  useEffect(() => {
    if (!project) {
      document.title = DEFAULT_TITLE
      return
    }
    document.title = dirty ? `${project.name}*` : project.name
  }, [project, dirty])

  return null
}
