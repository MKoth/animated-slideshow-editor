import { create } from 'zustand'
import {
  shadersApi,
  type ShaderDefinition,
  type ShaderImportInput,
  type ShaderUniformInput,
} from '../api'
import { compileFragmentShader, type ShaderCompileStatus } from '../shaders/compiler'
import { reflectUniforms, type ShaderReflection } from '../shaders/reflection'
import { libraryEventBus } from './libraryEvents'
import { notifyRequestFailure } from './requestNotifications'

export const IMPORT_FAILED_MESSAGE = 'Shader import failed.'
export const IMPORT_BACKEND_DOWN_MESSAGE = 'Shader import failed — backend unavailable.'
export const UPDATE_FAILED_MESSAGE = 'Shader update failed.'
export const UPDATE_BACKEND_DOWN_MESSAGE = 'Shader update failed — backend unavailable.'
export const DELETE_FAILED_MESSAGE = 'Shader delete failed.'
export const DELETE_BACKEND_DOWN_MESSAGE = 'Shader delete failed — backend unavailable.'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function replaceDefinition(
  definitions: ShaderDefinition[],
  updated: ShaderDefinition,
): ShaderDefinition[] {
  return definitions.map((definition) => (definition.id === updated.id ? updated : definition))
}

function compileAndReflect(definition: ShaderDefinition): {
  compileStatus: ShaderCompileStatus
  reflection: ShaderReflection
} {
  try {
    return {
      compileStatus: compileFragmentShader(definition.source),
      reflection: reflectUniforms(definition.source),
    }
  } catch (error) {
    return {
      compileStatus: { status: 'Failed', errors: [{ line: 0, message: errorMessage(error) }] },
      reflection: { uniforms: [], warnings: [] },
    }
  }
}

function emitCompileResult(id: string, status: ShaderCompileStatus): void {
  if (status.status === 'Compiled') {
    libraryEventBus.emit({ type: 'ShaderCompiled', id })
  } else {
    libraryEventBus.emit({ type: 'ShaderCompilationFailed', id, errors: status.errors })
  }
}

function uniformsForBackend(reflection: ShaderReflection): ShaderUniformInput[] {
  return reflection.uniforms.map((uniform) => ({
    key: uniform.key,
    kind: uniform.type,
    default: uniform.default ?? '',
  }))
}

async function persistReflectedUniforms(
  set: ShaderLibrarySetter,
  definition: ShaderDefinition,
  reflection: ShaderReflection,
): Promise<void> {
  try {
    const updated = await shadersApi.updateUniformDefaults(
      definition.id,
      uniformsForBackend(reflection),
    )
    set((state) => ({ definitions: replaceDefinition(state.definitions, updated) }))
  } catch (error) {
    notifyRequestFailure(UPDATE_FAILED_MESSAGE, UPDATE_BACKEND_DOWN_MESSAGE, error, () =>
      set(() => ({ unavailable: true, error: errorMessage(error) })),
    )
  }
}

type ShaderLibrarySetter = (
  update: (state: ShaderLibraryState) => Partial<ShaderLibraryState>,
) => void

async function registerDefinition(
  set: ShaderLibrarySetter,
  definition: ShaderDefinition,
): Promise<void> {
  const compiled = compileAndReflect(definition)
  set((state) => ({
    definitions: [definition, ...state.definitions],
    compileStatus: { ...state.compileStatus, [definition.id]: compiled.compileStatus },
    reflections: { ...state.reflections, [definition.id]: compiled.reflection },
  }))
  libraryEventBus.emit({ type: 'ShaderCreated', shader: definition })
  emitCompileResult(definition.id, compiled.compileStatus)
  await persistReflectedUniforms(set, definition, compiled.reflection)
}

interface ShaderLibraryState {
  definitions: ShaderDefinition[]
  compileStatus: Record<string, ShaderCompileStatus | undefined>
  reflections: Record<string, ShaderReflection | undefined>
  loaded: boolean
  loading: boolean
  error: string | null
  unavailable: boolean
  selectedId: string | null
  loadLibrary: () => Promise<void>
  selectShader: (shaderId: string | null) => void
  importShader: (file: File, input?: ShaderImportInput) => Promise<ShaderDefinition | null>
  duplicateShader: (sourceId: string, name: string) => Promise<ShaderDefinition | null>
  renameShader: (shaderId: string, name: string) => Promise<void>
  reuploadSource: (shaderId: string, file: File) => Promise<void>
  updateUniformDefaults: (shaderId: string, uniforms: ShaderUniformInput[]) => Promise<void>
  deleteShader: (shaderId: string) => Promise<void>
}

let requestSeq = 0

export const useShaderLibraryStore = create<ShaderLibraryState>()((set) => ({
  definitions: [],
  compileStatus: {},
  reflections: {},
  loaded: false,
  loading: false,
  error: null,
  unavailable: false,
  selectedId: null,

  loadLibrary: async () => {
    const seq = ++requestSeq
    set({ loading: true, error: null })
    try {
      const definitions = await shadersApi.listShaders()
      if (seq !== requestSeq) {
        return
      }
      const compileStatus: Record<string, ShaderCompileStatus> = {}
      const reflections: Record<string, ShaderReflection> = {}
      for (const definition of definitions) {
        const compiled = compileAndReflect(definition)
        compileStatus[definition.id] = compiled.compileStatus
        reflections[definition.id] = compiled.reflection
      }
      set({
        definitions,
        compileStatus,
        reflections,
        loaded: true,
        loading: false,
        unavailable: false,
      })
    } catch (error) {
      if (seq !== requestSeq) {
        return
      }
      set({
        definitions: [],
        compileStatus: {},
        reflections: {},
        selectedId: null,
        loaded: false,
        loading: false,
        unavailable: true,
        error: errorMessage(error),
      })
    }
  },

  selectShader: (shaderId) => set({ selectedId: shaderId }),

  importShader: async (file, input) => {
    try {
      const created = await shadersApi.importShader(file, input)
      await registerDefinition(set, created)
      return created
    } catch (error) {
      notifyRequestFailure(IMPORT_FAILED_MESSAGE, IMPORT_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return null
    }
  },

  duplicateShader: async (sourceId, name) => {
    try {
      const created = await shadersApi.duplicateShader(sourceId, name)
      await registerDefinition(set, created)
      return created
    } catch (error) {
      notifyRequestFailure(IMPORT_FAILED_MESSAGE, IMPORT_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return null
    }
  },

  renameShader: async (shaderId, name) => {
    try {
      const renamed = await shadersApi.renameShader(shaderId, name)
      set((state) => ({ definitions: replaceDefinition(state.definitions, renamed) }))
      libraryEventBus.emit({ type: 'ShaderRenamed', shader: renamed })
    } catch (error) {
      notifyRequestFailure(UPDATE_FAILED_MESSAGE, UPDATE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  reuploadSource: async (shaderId, file) => {
    try {
      const updated = await shadersApi.reuploadSource(shaderId, file)
      const compiled = compileAndReflect(updated)
      set((state) => ({
        definitions: replaceDefinition(state.definitions, updated),
        compileStatus: { ...state.compileStatus, [updated.id]: compiled.compileStatus },
        reflections: { ...state.reflections, [updated.id]: compiled.reflection },
      }))
      libraryEventBus.emit({ type: 'ShaderUpdated', shader: updated })
      emitCompileResult(updated.id, compiled.compileStatus)
      await persistReflectedUniforms(set, updated, compiled.reflection)
    } catch (error) {
      notifyRequestFailure(UPDATE_FAILED_MESSAGE, UPDATE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  updateUniformDefaults: async (shaderId, uniforms) => {
    try {
      const updated = await shadersApi.updateUniformDefaults(shaderId, uniforms)
      set((state) => ({ definitions: replaceDefinition(state.definitions, updated) }))
      libraryEventBus.emit({ type: 'ShaderUpdated', shader: updated })
    } catch (error) {
      notifyRequestFailure(UPDATE_FAILED_MESSAGE, UPDATE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  deleteShader: async (shaderId) => {
    try {
      await shadersApi.deleteShader(shaderId)
    } catch (error) {
      notifyRequestFailure(DELETE_FAILED_MESSAGE, DELETE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return
    }
    set((state) => {
      const compileStatus = { ...state.compileStatus }
      const reflections = { ...state.reflections }
      delete compileStatus[shaderId]
      delete reflections[shaderId]
      return {
        definitions: state.definitions.filter((definition) => definition.id !== shaderId),
        compileStatus,
        reflections,
        selectedId: state.selectedId === shaderId ? null : state.selectedId,
      }
    })
    libraryEventBus.emit({ type: 'ShaderRemoved', id: shaderId })
  },
}))
