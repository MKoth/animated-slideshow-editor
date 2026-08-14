import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearShadow,
  hasRecoverableShadow,
  loadRecoverableProject,
  readShadow,
  recordLastSaved,
  writeShadow,
} from '../app/recoveryShadow'
import { serialize } from '../engine/lessonSerializer'
import { makeProject } from './engine/helpers'

describe('recovery shadow storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('writes and reads the shadow blob', () => {
    writeShadow('{"version":1}')

    expect(readShadow()).toBe('{"version":1}')
  })

  it('returns null when no shadow exists', () => {
    expect(readShadow()).toBeNull()
  })

  it('clears the shadow', () => {
    writeShadow('{"version":1}')

    clearShadow()

    expect(readShadow()).toBeNull()
  })

  it('records the last saved blob', () => {
    recordLastSaved('{"version":1}')

    expect(readShadow()).toBeNull()
    expect(hasRecoverableShadow()).toBe(false)
  })
})

describe('hasRecoverableShadow', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('is false when no shadow exists', () => {
    recordLastSaved('{"version":1}')

    expect(hasRecoverableShadow()).toBe(false)
  })

  it('is false when the shadow matches the last saved state', () => {
    writeShadow('{"version":1}')
    recordLastSaved('{"version":1}')

    expect(hasRecoverableShadow()).toBe(false)
  })

  it('is true when the shadow differs from the last saved state', () => {
    writeShadow('{"version":1}')
    recordLastSaved('{"version":2}')

    expect(hasRecoverableShadow()).toBe(true)
  })

  it('is true when a shadow exists but nothing was ever saved', () => {
    writeShadow('{"version":1}')

    expect(hasRecoverableShadow()).toBe(true)
  })
})

describe('loadRecoverableProject', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('returns null when there is nothing to recover', () => {
    const blob = serialize(makeProject('Saved', ['S1']))
    writeShadow(blob)
    recordLastSaved(blob)

    expect(loadRecoverableProject()).toBeNull()
  })

  it('deserializes the shadow when it differs from the last saved state', () => {
    writeShadow(serialize(makeProject('Recovered', ['R1'])))
    recordLastSaved(serialize(makeProject('Saved', ['S1'])))

    const project = loadRecoverableProject()

    expect(project?.name).toBe('Recovered')
    expect(project?.slides.map((slide) => slide.name)).toEqual(['R1'])
  })

  it('clears a corrupt shadow and returns null', () => {
    writeShadow('{not valid json')
    recordLastSaved('{"version":1}')

    expect(loadRecoverableProject()).toBeNull()
    expect(readShadow()).toBeNull()
  })
})
