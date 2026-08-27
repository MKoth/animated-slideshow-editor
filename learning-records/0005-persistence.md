# Persistence system understanding established

The user now understands the persistence architecture: three independent safety nets (dirty flag, IndexedDB recovery shadow, backend save), the debounced + periodic autosave pattern, in-flight protection against overlapping saves, the .lesson file format with embedded definitions for self-contained portability, and offline-first behavior. Key insight: the backend stores opaque JSON blobs — it cannot query project internals, which is a deliberate simplicity trade-off.
