import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { CreateSlideCommand, DeleteSlideCommand } from '../../engine/commands'

export function SlidesPanel() {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((tick) => tick + 1))

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
    engine.setActiveSlide(slideId)
  }

  const handleDelete = (slideId: string) => {
    dispatch(new DeleteSlideCommand({ slideId }))
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
            return (
              <li key={slide.id} className="slides-list__item">
                <div
                  role="option"
                  aria-selected={active}
                  className={`slides-list__row${active ? ' slides-list__row--selected' : ''}`}
                  onClick={() => handleSelect(slide.id)}
                >
                  <span className="slides-list__thumb" aria-hidden="true" />
                  <span className="slides-list__name">{slide.name}</span>
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
