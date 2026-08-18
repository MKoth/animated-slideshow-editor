import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearRecoveryStorage,
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
  beforeEach(async () => {
    await clearRecoveryStorage()
  })

  afterEach(async () => {
    await clearRecoveryStorage()
  })

  it('writes and reads the shadow blob', async () => {
    await writeShadow('{"version":1}')

    expect(await readShadow()).toBe('{"version":1}')
  })

  it('returns null when no shadow exists', async () => {
    expect(await readShadow()).toBeNull()
  })

  it('clears the shadow', async () => {
    await writeShadow('{"version":1}')

    await clearShadow()

    expect(await readShadow()).toBeNull()
  })

  it('records the last saved blob', async () => {
    await recordLastSaved('{"version":1}')

    expect(await readShadow()).toBeNull()
    expect(await hasRecoverableShadow()).toBe(false)
  })
})

describe('hasRecoverableShadow', () => {
  beforeEach(async () => {
    await clearRecoveryStorage()
  })

  afterEach(async () => {
    await clearRecoveryStorage()
  })

  it('is false when no shadow exists', async () => {
    await recordLastSaved('{"version":1}')

    expect(await hasRecoverableShadow()).toBe(false)
  })

  it('is false when the shadow matches the last saved state', async () => {
    await writeShadow('{"version":1}')
    await recordLastSaved('{"version":1}')

    expect(await hasRecoverableShadow()).toBe(false)
  })

  it('is true when the shadow differs from the last saved state', async () => {
    await writeShadow('{"version":1}')
    await recordLastSaved('{"version":2}')

    expect(await hasRecoverableShadow()).toBe(true)
  })

  it('is true when a shadow exists but nothing was ever saved', async () => {
    await writeShadow('{"version":1}')

    expect(await hasRecoverableShadow()).toBe(true)
  })
})

describe('loadRecoverableProject', () => {
  beforeEach(async () => {
    await clearRecoveryStorage()
  })

  afterEach(async () => {
    await clearRecoveryStorage()
  })

  it('returns null when there is nothing to recover', async () => {
    const blob = serialize(makeProject('Saved', ['S1']))
    await writeShadow(blob)
    await recordLastSaved(blob)

    expect(await loadRecoverableProject()).toBeNull()
  })

  it('deserializes the shadow when it differs from the last saved state', async () => {
    await writeShadow(serialize(makeProject('Recovered', ['R1'])))
    await recordLastSaved(serialize(makeProject('Saved', ['S1'])))

    const result = await loadRecoverableProject()

    expect(result?.project.name).toBe('Recovered')
    expect(result?.project.slides.map((slide) => slide.name)).toEqual(['R1'])
  })

  it('clears a corrupt shadow and returns null', async () => {
    await writeShadow('{not valid json')
    await recordLastSaved('{"version":1}')

    expect(await loadRecoverableProject()).toBeNull()
    expect(await readShadow()).toBeNull()
  })
})

describe('legacy localStorage shadow migration', () => {
  beforeEach(async () => {
    await clearRecoveryStorage()
    localStorage.clear()
  })

  afterEach(async () => {
    await clearRecoveryStorage()
    localStorage.clear()
  })

  it('moves a pre-IndexedDB shadow from localStorage into the database on first load', async () => {
    const legacyBlob = serialize(makeProject('Legacy', ['L1']))
    localStorage.setItem('recoveryShadow', legacyBlob)
    localStorage.setItem('recoveryLastSaved', '{"version":1}')

    const result = await loadRecoverableProject()
    expect(result?.project.name).toBe('Legacy')
    expect(await readShadow()).toBe(legacyBlob)
    expect(localStorage.getItem('recoveryShadow')).toBeNull()
    expect(localStorage.getItem('recoveryLastSaved')).toBeNull()
  })

  it('keeps the restore/discard behavior unchanged after the migration', async () => {
    localStorage.setItem('recoveryShadow', serialize(makeProject('Legacy', ['L1'])))

    expect(await hasRecoverableShadow()).toBe(true)
    await clearShadow()

    expect(await readShadow()).toBeNull()
  })
})
