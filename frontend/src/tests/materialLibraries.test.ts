import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureMaterialLibrariesLoaded } from '../app/materialLibraries'
import { useMaterialLibraryStore } from '../stores/materialLibraryStore'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'

let materialLoad: ReturnType<typeof vi.fn<() => Promise<void>>>
let shaderLoad: ReturnType<typeof vi.fn<() => Promise<void>>>

beforeEach(() => {
  materialLoad = vi.fn(async () => undefined)
  shaderLoad = vi.fn(async () => undefined)
  useMaterialLibraryStore.setState({
    definitions: [],
    loaded: false,
    loading: false,
    unavailable: false,
    loadLibrary: materialLoad,
  })
  useShaderLibraryStore.setState({
    definitions: [],
    compileStatus: {},
    loaded: false,
    loading: false,
    unavailable: false,
    loadLibrary: shaderLoad,
  })
})

describe('ensureMaterialLibrariesLoaded', () => {
  it('loads both libraries when neither has loaded', async () => {
    await ensureMaterialLibrariesLoaded()

    expect(materialLoad).toHaveBeenCalledTimes(1)
    expect(shaderLoad).toHaveBeenCalledTimes(1)
  })

  it('loads only the library that has not loaded', async () => {
    useMaterialLibraryStore.setState({ loaded: true })

    await ensureMaterialLibrariesLoaded()

    expect(materialLoad).not.toHaveBeenCalled()
    expect(shaderLoad).toHaveBeenCalledTimes(1)
  })

  it('does not retry a library the backend reported unavailable', async () => {
    useMaterialLibraryStore.setState({ unavailable: true })
    useShaderLibraryStore.setState({ unavailable: true })

    await ensureMaterialLibrariesLoaded()

    expect(materialLoad).not.toHaveBeenCalled()
    expect(shaderLoad).not.toHaveBeenCalled()
  })
})
