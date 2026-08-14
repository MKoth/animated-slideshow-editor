import { create } from 'zustand'
import type { ProjectSummary } from '../api'

export const DEFAULT_PROJECT_NAME = 'Untitled lesson'

interface ProjectBrowserState {
  visible: boolean
  newProjectVisible: boolean
  newProjectName: string
  pendingOpen: ProjectSummary | null
  pendingNew: boolean
  projects: ProjectSummary[]
  loading: boolean
  error: string | null
  show: () => void
  hide: () => void
  showNewProject: () => void
  hideNewProject: () => void
  setNewProjectName: (name: string) => void
  requestOpen: (project: ProjectSummary) => void
  setPendingNew: (pending: boolean) => void
  clearPending: () => void
  setProjects: (projects: ProjectSummary[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  removeProject: (id: string) => void
}

export const useProjectBrowserStore = create<ProjectBrowserState>()((set) => ({
  visible: false,
  newProjectVisible: false,
  newProjectName: DEFAULT_PROJECT_NAME,
  pendingOpen: null,
  pendingNew: false,
  projects: [],
  loading: false,
  error: null,
  show: () => set({ visible: true }),
  hide: () =>
    set({ visible: false, newProjectVisible: false, pendingOpen: null, pendingNew: false }),
  showNewProject: () => set({ newProjectVisible: true, newProjectName: DEFAULT_PROJECT_NAME }),
  hideNewProject: () => set({ newProjectVisible: false }),
  setNewProjectName: (name) => set({ newProjectName: name }),
  requestOpen: (project) => set({ pendingOpen: project }),
  setPendingNew: (pending) => set({ pendingNew: pending }),
  clearPending: () => set({ pendingOpen: null, pendingNew: false }),
  setProjects: (projects) => set({ projects }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  removeProject: (id) =>
    set((state) => ({ projects: state.projects.filter((project) => project.id !== id) })),
}))
