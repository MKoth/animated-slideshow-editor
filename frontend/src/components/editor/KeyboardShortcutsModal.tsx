import { useEffect } from 'react'
import { SHORTCUT_CATALOG } from '../../shortcuts/shortcutCatalog'

export function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard Shortcuts"
      data-testid="keyboard-shortcuts-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: '#2a2a2a',
          border: '1px solid #444',
          borderRadius: 8,
          width: 640,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          color: '#e0e0e0',
        }}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Keyboard Shortcuts</h2>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#aaa' }}>
          View-only reference. `Ctrl/⌘` means Ctrl on Windows/Linux, ⌘ on macOS. Shortcuts are
          inactive while typing in text inputs (except Esc).
        </p>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {SHORTCUT_CATALOG.map((section) => (
            <section key={section.id} style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 13, color: '#fff' }}>{section.title}</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {section.entries.map((entry) => (
                    <tr
                      key={`${section.id}-${entry.action}`}
                      style={{ borderTop: '1px solid #3a3a3a' }}
                    >
                      <td style={{ padding: '5px 8px 5px 0', whiteSpace: 'nowrap', width: '38%' }}>
                        {entry.keys.map((key) => (
                          <kbd
                            key={key}
                            style={{
                              display: 'inline-block',
                              padding: '1px 6px',
                              marginRight: 4,
                              borderRadius: 4,
                              border: '1px solid #555',
                              background: '#1e1e1e',
                              fontFamily: 'inherit',
                              fontSize: 11,
                            }}
                          >
                            {key}
                          </kbd>
                        ))}
                      </td>
                      <td style={{ padding: '5px 8px 5px 0' }}>{entry.action}</td>
                      <td style={{ padding: '5px 0', color: '#999', fontSize: 11 }}>
                        {entry.context}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            data-testid="keyboard-shortcuts-close"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#333',
              color: '#e0e0e0',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
