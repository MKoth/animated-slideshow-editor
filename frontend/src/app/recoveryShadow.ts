const DB_NAME = 'animated-slideshow-editor'
const DB_VERSION = 1
const STORE_NAME = 'recovery'

export const RECOVERY_SHADOW_KEY = 'recoveryShadow'
export const LAST_SAVED_KEY = 'recoveryLastSaved'

const LEGACY_SHADOW_KEY = 'recoveryShadow'
const LEGACY_LAST_SAVED_KEY = 'recoveryLastSaved'

const dbPromise = openDatabase()

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open the recovery database'))
  })
}

async function migrateLegacyKeys(): Promise<void> {
  const legacyShadow = localStorage.getItem(LEGACY_SHADOW_KEY)
  const legacyLastSaved = localStorage.getItem(LEGACY_LAST_SAVED_KEY)
  if (legacyShadow === null && legacyLastSaved === null) {
    return
  }
  if (legacyShadow !== null) {
    await setItem(RECOVERY_SHADOW_KEY, legacyShadow)
    localStorage.removeItem(LEGACY_SHADOW_KEY)
  }
  if (legacyLastSaved !== null) {
    await setItem(LAST_SAVED_KEY, legacyLastSaved)
    localStorage.removeItem(LEGACY_LAST_SAVED_KEY)
  }
}

async function getItem(key: string): Promise<string | null> {
  await migrateLegacyKeys()
  const db = await dbPromise
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null)
    request.onerror = () => reject(request.error ?? new Error(`Failed to read "${key}"`))
  })
}

async function setItem(key: string, value: string): Promise<void> {
  const db = await dbPromise
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`Failed to write "${key}"`))
  })
}

async function removeItem(key: string): Promise<void> {
  const db = await dbPromise
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`Failed to clear "${key}"`))
  })
}

export function writeShadow(blob: string): Promise<void> {
  return setItem(RECOVERY_SHADOW_KEY, blob)
}

export function readShadow(): Promise<string | null> {
  return getItem(RECOVERY_SHADOW_KEY)
}

export function clearShadow(): Promise<void> {
  return removeItem(RECOVERY_SHADOW_KEY)
}

export function clearRecoveryStorage(): Promise<void> {
  return Promise.all([removeItem(RECOVERY_SHADOW_KEY), removeItem(LAST_SAVED_KEY)]).then(
    () => undefined,
  )
}

export function recordLastSaved(blob: string): Promise<void> {
  return setItem(LAST_SAVED_KEY, blob)
}

export function readLastSaved(): Promise<string | null> {
  return getItem(LAST_SAVED_KEY)
}

export async function hasRecoverableShadow(): Promise<boolean> {
  const shadow = await readShadow()
  if (shadow === null) {
    return false
  }
  return shadow !== (await getItem(LAST_SAVED_KEY))
}

export interface RecoveredProject {
  readonly json: string
}

export async function loadRecoverableProject(): Promise<RecoveredProject | null> {
  if (!(await hasRecoverableShadow())) {
    return null
  }
  const blob = await readShadow()
  if (blob === null) {
    return null
  }
  try {
    JSON.parse(blob)
    return { json: blob }
  } catch {
    await clearShadow()
    return null
  }
}
