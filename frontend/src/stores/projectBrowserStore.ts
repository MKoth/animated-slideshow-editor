import { create } from 'zustand'
import type { ProjectFolder, ProjectSummary } from '../api'

export const DEFAULT_PROJECT_NAME = 'Untitled lesson'
export const ALL_FOLDERS = 'all' as const
export const ROOT_FOLDER = 'root' as const

export type FolderFilter = typeof ALL_FOLDERS | typeof ROOT_FOLDER | string

interface ProjectBrowserState {
  visible: boolean
  newProjectVisible: boolean
  newProjectName: string
  pendingOpen: ProjectSummary | null
  pendingNew: boolean
  pendingImport: File | null
  projects: ProjectSummary[]
  folders: ProjectFolder[]
  selectedFolder: FolderFilter
  loading: boolean
  error: string | null
  show: () => void
  hide: () => void
  showNewProject: () => void
  hideNewProject: () => void
  setNewProjectName: (name: string) => void
  requestOpen: (project: ProjectSummary) => void
  setPendingNew: (pending: boolean) => void
  requestImport: (file: File) => void
  clearPending: () => void
  setProjects: (projects: ProjectSummary[]) => void
  setFolders: (folders: ProjectFolder[]) => void
  setSelectedFolder: (folder: FolderFilter) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  removeProject: (id: string) => void
  updateProjectFolder: (id: string, folder_id: string | null) => void
}

export const useProjectBrowserStore = create<ProjectBrowserState>()((set) => ({
  visible: false,
  newProjectVisible: false,
  newProjectName: DEFAULT_PROJECT_NAME,
  pendingOpen: null,
  pendingNew: false,
  pendingImport: null,
  projects: [],
  folders: [],
  selectedFolder: ALL_FOLDERS,
  loading: false,
  error: null,
  show: () => set({ visible: true }),
  hide: () =>
    set({
      visible: false,
      newProjectVisible: false,
      pendingOpen: null,
      pendingNew: false,
      pendingImport: null,
    }),
  showNewProject: () => set({ newProjectVisible: true, newProjectName: DEFAULT_PROJECT_NAME }),
  hideNewProject: () => set({ newProjectVisible: false }),
  setNewProjectName: (name) => set({ newProjectName: name }),
  requestOpen: (project) => set({ pendingOpen: project }),
  setPendingNew: (pending) => set({ pendingNew: pending }),
  requestImport: (file) => set({ pendingImport: file }),
  clearPending: () => set({ pendingOpen: null, pendingNew: false, pendingImport: null }),
  setProjects: (projects) => set({ projects }),
  setFolders: (folders) => set({ folders }),
  setSelectedFolder: (selectedFolder) => set({ selectedFolder }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  removeProject: (id) =>
    set((state) => ({ projects: state.projects.filter((project) => project.id !== id) })),
  updateProjectFolder: (id, folder_id) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === id ? { ...project, folder_id } : project,
      ),
    })),
}))
