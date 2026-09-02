import { openProjectBrowser, requestNewProject } from '../../app/projectBrowser'
import { useEngine } from '../../app/useEngine'
import { useNotificationStore } from '../../stores/notificationStore'
import { CreateNodeCommand } from '../../engine/commands'
import { createCircleComponent } from '../../engine/circleComponent'
import { namesInTree, uniqueNodeName } from '../../engine/naming'
import { useSelectionStore } from '../../stores/selectionStore'

const TOOLBAR_BUTTONS = [
  'New Project',
  'Open',
  'Save',
  'Circle',
  'Undo',
  'Redo',
  'Play',
  'Pause',
  'Stop',
  'AI Assistant',
] as const

export function Toolbar() {
  const { engine, dispatch, persistence } = useEngine()

  const handleClick = (label: string) => {
    if (label === 'Save') {
      persistence.save()
      return
    }
    if (label === 'Open') {
      openProjectBrowser()
      return
    }
    if (label === 'New Project') {
      requestNewProject()
      return
    }
    if (label === 'Circle') {
      const slide = engine.getActiveSlide()
      if (!slide) {
        useNotificationStore.getState().notify('No active slide')
        return
      }
      const taken = namesInTree(slide.scene.root)
      const name = uniqueNodeName(taken, 'Circle')
      const result = dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name,
          components: { circle: createCircleComponent() },
        }),
      )
      if (result.ok) {
        useSelectionStore.getState().select(result.inverse.nodeId)
      } else {
        useNotificationStore.getState().notify(result.error.message)
      }
      return
    }
    useNotificationStore.getState().notify('Not implemented yet.')
  }

  return (
    <div className="toolbar">
      {TOOLBAR_BUTTONS.map((label) => (
        <button key={label} className="toolbar__button" onClick={() => handleClick(label)}>
          {label}
        </button>
      ))}
    </div>
  )
}
