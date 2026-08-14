import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { moveSlide, renameSlide } from '../../app/slideActions'
import {
  CreateSlideCommand,
  DeleteSlideCommand,
  DuplicateSlideCommand,
} from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'
import { useThumbnailStore } from '../../stores/thumbnailStore'

export function SlidesPanel() {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((state) => state.notify)
  const thumbnails = useThumbnailStore((state) => state.thumbnails)
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((tick) => tick + 1))

  const [renameId, setRenameId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState<{
    slideId: string
    position: 'before' | 'after'
  } | null>(null)

  const project = engine.project

  if (!project) {
    return (
      <div className="panel-empty-state">
        <p>No slides created.</p>
      </div>
    )
  }

  const handleAdd = () => {
    dispatch(new CreateSlideCommand())
  }

  const handleSelect = (slideId: string) => {
    if (slideId !== engine.activeSlideId) {
      engine.setActiveSlide(slideId)
    }
  }

  const handleDelete = (slideId: string) => {
    dispatch(new DeleteSlideCommand({ slideId }))
  }

  const handleDuplicate = (slideId: string) => {
    dispatch(new DuplicateSlideCommand({ slideId }))
  }

  const commitRename = (slideId: string, name: string) => {
    setRenameId(null)
    renameSlide(engine, dispatch, slideId, name, notify)
  }

  const positionAt = (event: React.DragEvent): 'before' | 'after' => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
  }

  const handleDragStart = (event: React.DragEvent, slideId: string) => {
    setDragId(slideId)
    event.dataTransfer.setData('application/x.slide-id', slideId)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (event: React.DragEvent, slideId: string) => {
    if (!dragId || dragId === slideId) {
      return
    }
    event.preventDefault()
    setDropOver({ slideId, position: positionAt(event) })
  }

  const handleDragLeave = (slideId: string) => {
    if (dropOver?.slideId === slideId) {
      setDropOver(null)
    }
  }

  const handleDragEnd = () => {
    setDragId(null)
    setDropOver(null)
  }

  const handleDrop = (event: React.DragEvent, targetSlideId: string) => {
    event.preventDefault()
    const slides = project.slides
    if (!dragId) {
      return
    }
    const from = slides.findIndex((slide) => slide.id === dragId)
    const to = slides.findIndex((slide) => slide.id === targetSlideId)
    const insertAt = to + (positionAt(event) === 'after' ? 1 : 0)
    const index = insertAt > from ? insertAt - 1 : insertAt
    setDragId(null)
    setDropOver(null)
    if (from === -1 || index === from) {
      return
    }
    moveSlide(engine, dispatch, dragId, index, notify)
  }

  return (
    <div className="slides-panel">
      <div className="slides-toolbar">
        <button
          className="slides-toolbar__add"
          aria-label="Add Slide"
          title="Add slide"
          onClick={handleAdd}
        >
          +
        </button>
      </div>
      {project.slides.length === 0 ? (
        <div className="panel-empty-state">
          <p>No slides created.</p>
        </div>
      ) : (
        <ul className="slides-list" role="listbox" aria-label="Slides">
          {project.slides.map((slide) => {
            const active = slide.id === engine.activeSlideId
            const thumbnail = thumbnails[slide.id] ?? null
            const editing = renameId === slide.id
            const dropZone = dropOver?.slideId === slide.id ? dropOver.position : null
            return (
              <li key={slide.id} className="slides-list__item">
                <div
                  role="option"
                  aria-selected={active}
                  draggable
                  className={`slides-list__row${active ? ' slides-list__row--selected' : ''}${
                    dropZone === 'before' ? ' slides-list__row--drop-before' : ''
                  }${dropZone === 'after' ? ' slides-list__row--drop-after' : ''}`}
                  onClick={() => handleSelect(slide.id)}
                  onDragStart={(event) => handleDragStart(event, slide.id)}
                  onDragOver={(event) => handleDragOver(event, slide.id)}
                  onDragLeave={() => handleDragLeave(slide.id)}
                  onDrop={(event) => handleDrop(event, slide.id)}
                  onDragEnd={handleDragEnd}
                >
                  <span className="slides-list__thumb" aria-hidden="true">
                    {thumbnail && (
                      <img
                        className="slides-list__thumb-img"
                        src={thumbnail}
                        alt=""
                        draggable={false}
                      />
                    )}
                  </span>
                  {editing ? (
                    <input
                      className="slides-list__rename"
                      aria-label={`Rename ${slide.name}`}
                      defaultValue={slide.name}
                      autoFocus
                      onFocus={(event) => event.target.select()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          commitRename(slide.id, event.currentTarget.value)
                        } else if (event.key === 'Escape') {
                          setRenameId(null)
                        }
                      }}
                      onBlur={(event) => {
                        if (renameId === slide.id) {
                          commitRename(slide.id, event.target.value)
                        }
                      }}
                    />
                  ) : (
                    <span
                      className="slides-list__name"
                      title="Rename"
                      onDoubleClick={() => setRenameId(slide.id)}
                    >
                      {slide.name}
                    </span>
                  )}
                  <span className="slides-list__duration">{slide.duration} s</span>
                  {active && (
                    <span
                      className="slides-list__indicator"
                      title="Active slide"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <button
                  className="slides-list__duplicate"
                  aria-label={`Duplicate ${slide.name}`}
                  title={`Duplicate ${slide.name}`}
                  onClick={() => handleDuplicate(slide.id)}
                >
                  ⧉
                </button>
                <button
                  className="slides-list__delete"
                  aria-label={`Delete ${slide.name}`}
                  title={`Delete ${slide.name}`}
                  disabled={project.slides.length === 1}
                  onClick={() => handleDelete(slide.id)}
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
