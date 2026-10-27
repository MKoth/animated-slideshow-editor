import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ProjectSummary } from '../../api'
import {
  createAndOpenFreshProject,
  createLibraryFolder,
  deleteLibraryFolder,
  deleteLibraryProject,
  downloadBackupZip,
  duplicateLibraryProject,
  formatLastModified,
  isDuplicateFolderName,
  isDuplicateProjectName,
  moveLibraryProject,
  openLibraryProject,
  refreshProjects,
  renameLibraryFolder,
  renameLibraryProject,
  requestNewProject,
} from '../../app/projectBrowser'
import { downloadLessonCopy, importLessonFile } from '../../app/lessonTransfer'
import { useEngine } from '../../app/useEngine'
import { usePersistenceStore } from '../../stores/persistenceStore'
import { ALL_FOLDERS, ROOT_FOLDER, useProjectBrowserStore } from '../../stores/projectBrowserStore'
import type { FolderFilter } from '../../stores/projectBrowserStore'

export function ProjectsDialog() {
  const { engine, persistence } = useEngine()
  const visible = useProjectBrowserStore((state) => state.visible)
  const newProjectVisible = useProjectBrowserStore((state) => state.newProjectVisible)
  const newProjectName = useProjectBrowserStore((state) => state.newProjectName)
  const pendingOpen = useProjectBrowserStore((state) => state.pendingOpen)
  const pendingNew = useProjectBrowserStore((state) => state.pendingNew)
  const pendingImport = useProjectBrowserStore((state) => state.pendingImport)
  const projects = useProjectBrowserStore((state) => state.projects)
  const folders = useProjectBrowserStore((state) => state.folders)
  const selectedFolder = useProjectBrowserStore((state) => state.selectedFolder)
  const loading = useProjectBrowserStore((state) => state.loading)
  const error = useProjectBrowserStore((state) => state.error)
  const dirty = usePersistenceStore((state) => state.dirty)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [addingFolder, setAddingFolder] = useState(false)
  const [folderDraft, setFolderDraft] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderDraft, setRenameFolderDraft] = useState('')
  const [renameFolderError, setRenameFolderError] = useState<string | null>(null)
  const [pendingDeleteFolderId, setPendingDeleteFolderId] = useState<string | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)

  useEffect(() => {
    if (visible) {
      void refreshProjects()
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient UI when dialog closes
      setRenamingId(null)

      setRenameDraft('')

      setRenameError(null)

      setRenamingBusy(false)
      setAddingFolder(false)
      setFolderDraft('')
      setFolderError(null)
      setFolderBusy(false)
      setRenamingFolderId(null)
      setRenameFolderDraft('')
      setRenameFolderError(null)
      setPendingDeleteFolderId(null)
      setBackupBusy(false)
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

  const handleDuplicate = (project: ProjectSummary): void => {
    void duplicateLibraryProject(project.id)
  }

  const handleMove = (project: ProjectSummary, folderId: string | null): void => {
    if ((project.folder_id ?? null) === folderId) return
    void moveLibraryProject(project.id, folderId)
  }

  const handleStartRename = (project: ProjectSummary): void => {
    setRenamingId(project.id)
    setRenameDraft(project.name)
    setRenameError(null)
  }

  const handleCancelRename = (): void => {
    setRenamingId(null)
    setRenameDraft('')
    setRenameError(null)
    setRenamingBusy(false)
  }

  const handleConfirmRename = async (project: ProjectSummary): Promise<void> => {
    const trimmed = renameDraft.trim()
    if (trimmed === '') {
      setRenameError('Project name must not be empty')
      return
    }
    if (trimmed === project.name) {
      handleCancelRename()
      return
    }
    const existingNames = projects.filter((p) => p.id !== project.id).map((p) => p.name)
    if (isDuplicateProjectName(trimmed, existingNames)) {
      setRenameError('A project with this name already exists')
      return
    }
    setRenamingBusy(true)
    const ok = await renameLibraryProject(engine, project.id, trimmed)
    setRenamingBusy(false)
    if (ok) {
      handleCancelRename()
    } else {
      setRenameError('Could not rename the project')
    }
  }

  const handleConfirmAddFolder = async (): Promise<void> => {
    const trimmed = folderDraft.trim()
    if (trimmed === '') {
      setFolderError('Folder name must not be empty')
      return
    }
    if (
      isDuplicateFolderName(
        trimmed,
        folders.map((f) => f.name),
      )
    ) {
      setFolderError('A folder with this name already exists')
      return
    }
    setFolderBusy(true)
    const ok = await createLibraryFolder(trimmed)
    setFolderBusy(false)
    if (ok) {
      setAddingFolder(false)
      setFolderDraft('')
      setFolderError(null)
    } else {
      setFolderError('Could not create the folder')
    }
  }

  const handleConfirmRenameFolder = async (folderId: string): Promise<void> => {
    const trimmed = renameFolderDraft.trim()
    if (trimmed === '') {
      setRenameFolderError('Folder name must not be empty')
      return
    }
    const folder = folders.find((f) => f.id === folderId)
    if (folder && trimmed === folder.name) {
      setRenamingFolderId(null)
      setRenameFolderDraft('')
      setRenameFolderError(null)
      return
    }
    if (
      isDuplicateFolderName(
        trimmed,
        folders.filter((f) => f.id !== folderId).map((f) => f.name),
      )
    ) {
      setRenameFolderError('A folder with this name already exists')
      return
    }
    const ok = await renameLibraryFolder(folderId, trimmed)
    if (ok) {
      setRenamingFolderId(null)
      setRenameFolderDraft('')
      setRenameFolderError(null)
    } else {
      setRenameFolderError('Could not rename the folder')
    }
  }

  const handleDeleteFolder = (folderId: string): void => {
    // Empty folders delete immediately; non-empty ask move-to-root vs delete-together.
    const count = projects.filter((p) => p.folder_id === folderId).length
    if (count === 0) {
      void deleteLibraryFolder(folderId, false)
    } else {
      setPendingDeleteFolderId(folderId)
    }
  }

  const handleBackup = (): void => {
    setBackupBusy(true)
    void downloadBackupZip().finally(() => setBackupBusy(false))
  }

  const selectFolder = (filter: FolderFilter): void => {
    useProjectBrowserStore.getState().setSelectedFolder(filter)
  }

  const visibleProjects =
    selectedFolder === ALL_FOLDERS
      ? projects
      : selectedFolder === ROOT_FOLDER
        ? projects.filter((p) => p.folder_id == null)
        : projects.filter((p) => p.folder_id === selectedFolder)

  const rootCount = projects.filter((p) => p.folder_id == null).length
  const countFor = (folderId: string): number =>
    projects.filter((p) => p.folder_id === folderId).length
  const folderNameFor = (folderId: string | null): string => {
    if (folderId == null) return 'Uncategorized'
    return folders.find((f) => f.id === folderId)?.name ?? 'Unknown folder'
  }
  const selectedFolderName =
    selectedFolder === ALL_FOLDERS
      ? 'All'
      : selectedFolder === ROOT_FOLDER
        ? 'Uncategorized'
        : (folders.find((f) => f.id === selectedFolder)?.name ?? 'Folder')
  const pendingDeleteFolder =
    pendingDeleteFolderId != null ? folders.find((f) => f.id === pendingDeleteFolderId) : undefined
  const pendingDeleteCount = pendingDeleteFolderId != null ? countFor(pendingDeleteFolderId) : 0

  if (pendingDeleteFolderId && pendingDeleteFolder) {
    return (
      <div className="projects-overlay">
        <div className="projects-dialog" role="dialog" aria-label="Delete folder">
          <p className="projects-dialog__message">
            {`"${pendingDeleteFolder.name}" contains ${pendingDeleteCount} project${pendingDeleteCount === 1 ? '' : 's'}. Move them to Uncategorized, or delete them together with the folder?`}
          </p>
          <div className="projects-dialog__actions">
            <button
              className="projects-dialog__button"
              onClick={() => setPendingDeleteFolderId(null)}
            >
              Cancel
            </button>
            <button
              className="projects-dialog__button"
              onClick={() => {
                const id = pendingDeleteFolderId
                setPendingDeleteFolderId(null)
                void deleteLibraryFolder(id, false)
              }}
            >
              Move to Uncategorized
            </button>
            <button
              className="projects-dialog__button projects-dialog__button--danger"
              onClick={() => {
                const id = pendingDeleteFolderId
                setPendingDeleteFolderId(null)
                void deleteLibraryFolder(id, true)
              }}
            >
              Delete folder &amp; projects
            </button>
          </div>
        </div>
      </div>
    )
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
          <h2 className="projects-dialog__title">New Project in {selectedFolderName}</h2>
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
      <div
        className="projects-dialog projects-dialog--browser projects-dialog--with-folders"
        role="dialog"
        aria-label="Projects"
      >
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
        <div className="projects-dialog__body">
          <aside className="projects-dialog__folders" aria-label="Folders">
            <ul className="projects-dialog__folder-list" role="list" aria-label="Folder list">
              <li>
                <button
                  className={`projects-dialog__folder${selectedFolder === ALL_FOLDERS ? ' projects-dialog__folder--active' : ''}`}
                  aria-label="All projects"
                  aria-current={selectedFolder === ALL_FOLDERS ? 'true' : undefined}
                  onClick={() => selectFolder(ALL_FOLDERS)}
                >
                  <span>All</span>
                  <span className="projects-dialog__folder-count">{projects.length}</span>
                </button>
              </li>
              <li>
                <button
                  className={`projects-dialog__folder${selectedFolder === ROOT_FOLDER ? ' projects-dialog__folder--active' : ''}`}
                  aria-label="Uncategorized projects"
                  aria-current={selectedFolder === ROOT_FOLDER ? 'true' : undefined}
                  onClick={() => selectFolder(ROOT_FOLDER)}
                >
                  <span>Uncategorized</span>
                  <span className="projects-dialog__folder-count">{rootCount}</span>
                </button>
              </li>
              {folders.map((folder) => {
                const isActive = selectedFolder === folder.id
                const isRenaming = renamingFolderId === folder.id
                return (
                  <li key={folder.id} className="projects-dialog__folder-row">
                    {isRenaming ? (
                      <div className="projects-dialog__folder-rename">
                        <input
                          className="projects-dialog__input projects-dialog__rename-input"
                          aria-label={`Rename folder ${folder.name}`}
                          value={renameFolderDraft}
                          autoFocus
                          onChange={(event) => {
                            setRenameFolderDraft(event.target.value)
                            setRenameFolderError(null)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              void handleConfirmRenameFolder(folder.id)
                            } else if (event.key === 'Escape') {
                              setRenamingFolderId(null)
                              setRenameFolderDraft('')
                              setRenameFolderError(null)
                            }
                          }}
                          data-testid={`rename-folder-input-${folder.id}`}
                        />
                        <div className="projects-dialog__inline-actions">
                          <button
                            className="projects-dialog__button"
                            disabled={renameFolderDraft.trim() === ''}
                            onClick={() => void handleConfirmRenameFolder(folder.id)}
                            data-testid={`rename-folder-save-${folder.id}`}
                          >
                            Save
                          </button>
                          <button
                            className="projects-dialog__button"
                            onClick={() => {
                              setRenamingFolderId(null)
                              setRenameFolderDraft('')
                              setRenameFolderError(null)
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                        {renameFolderError ? (
                          <p className="projects-dialog__rename-error" role="alert">
                            {renameFolderError}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <button
                          className={`projects-dialog__folder${isActive ? ' projects-dialog__folder--active' : ''}`}
                          aria-label={`Folder ${folder.name}`}
                          aria-current={isActive ? 'true' : undefined}
                          onClick={() => selectFolder(folder.id)}
                        >
                          <span className="projects-dialog__folder-name">{folder.name}</span>
                          <span className="projects-dialog__folder-count">
                            {countFor(folder.id)}
                          </span>
                        </button>
                        <div className="projects-dialog__folder-actions">
                          <button
                            className="projects-dialog__icon-button"
                            aria-label={`Rename folder ${folder.name}`}
                            title={`Rename folder ${folder.name}`}
                            onClick={() => {
                              setRenamingFolderId(folder.id)
                              setRenameFolderDraft(folder.name)
                              setRenameFolderError(null)
                            }}
                            data-testid={`rename-folder-${folder.id}`}
                          >
                            ✎
                          </button>
                          <button
                            className="projects-dialog__icon-button"
                            aria-label={`Delete folder ${folder.name}`}
                            title={`Delete folder ${folder.name}`}
                            onClick={() => handleDeleteFolder(folder.id)}
                            data-testid={`delete-folder-${folder.id}`}
                          >
                            🗑
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
            {addingFolder ? (
              <div className="projects-dialog__folder-add">
                <input
                  className="projects-dialog__input"
                  aria-label="Folder name"
                  placeholder="Folder name"
                  value={folderDraft}
                  autoFocus
                  disabled={folderBusy}
                  onChange={(event) => {
                    setFolderDraft(event.target.value)
                    setFolderError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleConfirmAddFolder()
                    } else if (event.key === 'Escape') {
                      setAddingFolder(false)
                      setFolderDraft('')
                      setFolderError(null)
                    }
                  }}
                />
                <div className="projects-dialog__inline-actions">
                  <button
                    className="projects-dialog__button"
                    disabled={folderBusy || folderDraft.trim() === ''}
                    onClick={() => void handleConfirmAddFolder()}
                  >
                    Add
                  </button>
                  <button
                    className="projects-dialog__button"
                    disabled={folderBusy}
                    onClick={() => {
                      setAddingFolder(false)
                      setFolderDraft('')
                      setFolderError(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {folderError ? (
                  <p className="projects-dialog__rename-error" role="alert">
                    {folderError}
                  </p>
                ) : null}
              </div>
            ) : (
              <button
                className="projects-dialog__button projects-dialog__add-folder"
                onClick={() => {
                  setAddingFolder(true)
                  setFolderDraft('')
                  setFolderError(null)
                }}
              >
                + Add folder
              </button>
            )}
          </aside>
          <section
            className="projects-dialog__main"
            aria-label={`Projects in ${selectedFolderName}`}
          >
            {loading ? (
              <p className="projects-dialog__status">Loading projects…</p>
            ) : error ? (
              <div className="projects-dialog__error">
                <p className="projects-dialog__status">{error}</p>
                <button className="projects-dialog__button" onClick={() => void refreshProjects()}>
                  Retry
                </button>
              </div>
            ) : visibleProjects.length === 0 ? (
              <p className="projects-dialog__status">
                {projects.length === 0
                  ? 'No projects yet.'
                  : `No projects in ${selectedFolderName}.`}
              </p>
            ) : (
              <ul className="projects-dialog__list" role="list" aria-label="Projects list">
                {visibleProjects.map((project) => {
                  const isRenaming = renamingId === project.id
                  return (
                    <li
                      key={project.id}
                      className={`projects-dialog__row${isRenaming ? ' projects-dialog__row--editing' : ''}`}
                    >
                      {isRenaming ? (
                        <>
                          <div className="projects-dialog__rename">
                            <input
                              className="projects-dialog__input projects-dialog__rename-input"
                              aria-label={`Rename ${project.name}`}
                              value={renameDraft}
                              autoFocus
                              disabled={renamingBusy}
                              onChange={(event) => {
                                setRenameDraft(event.target.value)
                                setRenameError(null)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  void handleConfirmRename(project)
                                } else if (event.key === 'Escape') {
                                  handleCancelRename()
                                }
                              }}
                              data-testid={`rename-input-${project.id}`}
                            />
                            <div className="projects-dialog__inline-actions">
                              <button
                                className="projects-dialog__button"
                                disabled={renamingBusy || renameDraft.trim() === ''}
                                onClick={() => void handleConfirmRename(project)}
                                data-testid={`rename-save-${project.id}`}
                              >
                                Save
                              </button>
                              <button
                                className="projects-dialog__button"
                                disabled={renamingBusy}
                                onClick={handleCancelRename}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                          {renameError ? (
                            <p className="projects-dialog__rename-error" role="alert">
                              {renameError}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <div className="projects-dialog__meta">
                            <span className="projects-dialog__name">{project.name}</span>
                            <span className="projects-dialog__date">
                              {formatLastModified(project.lastModified)}
                            </span>
                            {selectedFolder === ALL_FOLDERS ? (
                              <span className="projects-dialog__folder-tag">
                                {folderNameFor(project.folder_id ?? null)}
                              </span>
                            ) : null}
                          </div>
                          <div className="projects-dialog__row-actions projects-dialog__row-actions--with-folder">
                            <select
                              className="projects-dialog__select"
                              aria-label={`Move ${project.name} to folder`}
                              value={project.folder_id ?? ''}
                              onChange={(event) =>
                                handleMove(
                                  project,
                                  event.target.value === '' ? null : event.target.value,
                                )
                              }
                              data-testid={`move-${project.id}`}
                            >
                              <option value="">Uncategorized</option>
                              {folders.map((folder) => (
                                <option key={folder.id} value={folder.id}>
                                  {folder.name}
                                </option>
                              ))}
                            </select>
                            <button
                              className="projects-dialog__button"
                              aria-label={`Open ${project.name}`}
                              onClick={() => handleOpen(project)}
                            >
                              Open
                            </button>
                            <button
                              className="projects-dialog__button"
                              aria-label={`Rename ${project.name}`}
                              onClick={() => handleStartRename(project)}
                              data-testid={`rename-${project.id}`}
                            >
                              Rename
                            </button>
                            <button
                              className="projects-dialog__button"
                              aria-label={`Duplicate ${project.name}`}
                              onClick={() => handleDuplicate(project)}
                            >
                              Duplicate
                            </button>
                            <button
                              className="projects-dialog__button"
                              aria-label={`Delete ${project.name}`}
                              onClick={() => handleDelete(project)}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
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
          <button
            className="projects-dialog__button"
            disabled={projects.length === 0 || backupBusy}
            onClick={handleBackup}
          >
            {backupBusy ? 'Building backup…' : 'Download backup zip'}
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
