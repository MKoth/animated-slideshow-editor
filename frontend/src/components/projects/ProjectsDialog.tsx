import { useEffect, useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { ProjectSummary } from '../../api'
import {
  createAndOpenFreshProject,
  deleteLibraryProject,
  formatLastModified,
  openLibraryProject,
  refreshProjects,
  requestNewProject,
} from '../../app/projectBrowser'
import { downloadLessonCopy, importLessonFile } from '../../app/lessonTransfer'
import { useEngine } from '../../app/useEngine'
import { usePersistenceStore } from '../../stores/persistenceStore'
import { useProjectBrowserStore } from '../../stores/projectBrowserStore'

export function ProjectsDialog() {
  const { engine, persistence } = useEngine()
  const visible = useProjectBrowserStore((state) => state.visible)
  const newProjectVisible = useProjectBrowserStore((state) => state.newProjectVisible)
  const newProjectName = useProjectBrowserStore((state) => state.newProjectName)
  const pendingOpen = useProjectBrowserStore((state) => state.pendingOpen)
  const pendingNew = useProjectBrowserStore((state) => state.pendingNew)
  const pendingImport = useProjectBrowserStore((state) => state.pendingImport)
  const projects = useProjectBrowserStore((state) => state.projects)
  const loading = useProjectBrowserStore((state) => state.loading)
  const error = useProjectBrowserStore((state) => state.error)
  const dirty = usePersistenceStore((state) => state.dirty)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      void refreshProjects()
    }
  }, [visible])

  if (!visible) {
    return null
  }

  const openProject = async (project: ProjectSummary): Promise<void> => {
    if (await openLibraryProject(engine, project.id)) {
      useProjectBrowserStore.getState().hide()
    }
  }

  const importNow = async (file: File): Promise<void> => {
    if (await importLessonFile(engine, file)) {
      useProjectBrowserStore.getState().hide()
    }
  }

  const handleImportFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (dirty) {
      useProjectBrowserStore.getState().requestImport(file)
    } else {
      void importNow(file)
    }
  }

  const handleConfirmImport = (): void => {
    const file = pendingImport
    useProjectBrowserStore.getState().clearPending()
    if (file) {
      void importNow(file)
    }
  }

  const handleOpen = (project: ProjectSummary): void => {
    if (dirty) {
      useProjectBrowserStore.getState().requestOpen(project)
    } else {
      void openProject(project)
    }
  }

  const handleConfirmOpen = (): void => {
    const project = pendingOpen
    useProjectBrowserStore.getState().clearPending()
    if (project) {
      void openProject(project)
    }
  }

  const handleConfirmNew = (): void => {
    useProjectBrowserStore.getState().clearPending()
    useProjectBrowserStore.getState().showNewProject()
  }

  const handleCancelPending = (): void => {
    useProjectBrowserStore.getState().clearPending()
  }

  const handleCreate = (): void => {
    if (createAndOpenFreshProject(engine, newProjectName)) {
      useProjectBrowserStore.getState().hide()
      persistence.save()
    }
  }

  const handleDelete = (project: ProjectSummary): void => {
    void deleteLibraryProject(project.id)
  }

  if (pendingOpen) {
    return (
      <div className="projects-overlay">
        <div className="projects-dialog" role="dialog" aria-label="Projects">
          <p className="projects-dialog__message">
            {`Discard unsaved changes to the current project and open "${pendingOpen.name}"?`}
          </p>
          <div className="projects-dialog__actions">
            <button className="projects-dialog__button" onClick={handleCancelPending}>
              Cancel
            </button>
            <button className="projects-dialog__button" onClick={handleConfirmOpen}>
              Discard &amp; Open
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (pendingNew) {
    return (
      <div className="projects-overlay">
        <div className="projects-dialog" role="dialog" aria-label="Projects">
          <p className="projects-dialog__message">
            Discard unsaved changes to the current project and create a new one?
          </p>
          <div className="projects-dialog__actions">
            <button className="projects-dialog__button" onClick={handleCancelPending}>
              Cancel
            </button>
            <button className="projects-dialog__button" onClick={handleConfirmNew}>
              Discard &amp; Create
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (pendingImport) {
    return (
      <div className="projects-overlay">
        <div className="projects-dialog" role="dialog" aria-label="Projects">
          <p className="projects-dialog__message">
            {`Discard unsaved changes to the current project and import "${pendingImport.name}"?`}
          </p>
          <div className="projects-dialog__actions">
            <button className="projects-dialog__button" onClick={handleCancelPending}>
              Cancel
            </button>
            <button className="projects-dialog__button" onClick={handleConfirmImport}>
              Discard &amp; Import
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (newProjectVisible) {
    return (
      <div className="projects-overlay">
        <div className="projects-dialog" role="dialog" aria-label="Projects">
          <h2 className="projects-dialog__title">New Project</h2>
          <label className="projects-dialog__field">
            Project name
            <input
              className="projects-dialog__input"
              aria-label="Project name"
              value={newProjectName}
              autoFocus
              onChange={(event) =>
                useProjectBrowserStore.getState().setNewProjectName(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleCreate()
                }
              }}
            />
          </label>
          <div className="projects-dialog__actions">
            <button
              className="projects-dialog__button"
              onClick={() => useProjectBrowserStore.getState().hideNewProject()}
            >
              Cancel
            </button>
            <button className="projects-dialog__button" onClick={handleCreate}>
              Create Project
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="projects-overlay">
      <div className="projects-dialog projects-dialog--browser" role="dialog" aria-label="Projects">
        <header className="projects-dialog__header">
          <h2 className="projects-dialog__title">Projects</h2>
          <button
            className="projects-dialog__close"
            aria-label="Close"
            onClick={() => useProjectBrowserStore.getState().hide()}
          >
            ✕
          </button>
        </header>
        {loading ? (
          <p className="projects-dialog__status">Loading projects…</p>
        ) : error ? (
          <div className="projects-dialog__error">
            <p className="projects-dialog__status">{error}</p>
            <button className="projects-dialog__button" onClick={() => void refreshProjects()}>
              Retry
            </button>
          </div>
        ) : projects.length === 0 ? (
          <p className="projects-dialog__status">No projects yet.</p>
        ) : (
          <ul className="projects-dialog__list" role="list">
            {projects.map((project) => (
              <li key={project.id} className="projects-dialog__row">
                <div className="projects-dialog__meta">
                  <span className="projects-dialog__name">{project.name}</span>
                  <span className="projects-dialog__date">
                    {formatLastModified(project.lastModified)}
                  </span>
                </div>
                <div className="projects-dialog__row-actions">
                  <button className="projects-dialog__button" onClick={() => handleOpen(project)}>
                    {`Open ${project.name}`}
                  </button>
                  <button className="projects-dialog__button" onClick={() => handleDelete(project)}>
                    {`Delete ${project.name}`}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <footer className="projects-dialog__footer">
          <button className="projects-dialog__button" onClick={() => requestNewProject()}>
            New Project
          </button>
          <button className="projects-dialog__button" onClick={() => fileInputRef.current?.click()}>
            Import .lesson
          </button>
          <button
            className="projects-dialog__button"
            disabled={!engine.project}
            onClick={() => downloadLessonCopy(engine)}
          >
            Download .lesson copy
          </button>
        </footer>
        <input
          ref={fileInputRef}
          type="file"
          accept=".lesson"
          hidden
          onChange={handleImportFiles}
        />
      </div>
    </div>
  )
}
