import { useEffect, useRef, useState } from 'react'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { triggerAssetImport } from '../assets/importTrigger'

const IMPORT_ASSETS_ITEM = 'Import Assets'

const MENUS = [
  {
    label: 'File',
    items: ['New Project', 'Open', 'Save'],
  },
  {
    label: 'Edit',
    items: ['Undo', 'Redo'],
  },
  {
    label: 'View',
    items: ['Zoom In', 'Zoom Out'],
  },
  {
    label: 'Assets',
    items: [IMPORT_ASSETS_ITEM],
  },
  {
    label: 'AI',
    items: ['AI Assistant'],
  },
  {
    label: 'Help',
    items: ['About'],
  },
] as const

interface MenuProps {
  label: string
  items: readonly string[]
  libraryUnavailable: boolean
}

function Menu({ label, items, libraryUnavailable }: MenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', closeOnOutsideClick)
    return () => document.removeEventListener('click', closeOnOutsideClick)
  }, [open])

  const handleItemClick = (item: string) => {
    if (item === IMPORT_ASSETS_ITEM) {
      triggerAssetImport()
    } else {
      useNotificationStore.getState().notify('Not implemented yet.')
    }
    setOpen(false)
  }

  return (
    <div className="menu" ref={menuRef}>
      <button className="menu__button" onClick={() => setOpen((current) => !current)}>
        {label}
      </button>
      {open && (
        <ul className="menu__dropdown" role="menu">
          {items.map((item) => (
            <li key={item}>
              <button
                className="menu__item"
                role="menuitem"
                disabled={item === IMPORT_ASSETS_ITEM && libraryUnavailable}
                onClick={() => handleItemClick(item)}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MenuBar() {
  const libraryUnavailable = useAssetLibraryStore((state) => state.unavailable)

  return (
    <header className="menu-bar">
      <span className="menu-bar__title">AI Slideshow Editor</span>
      <nav className="menu-bar__menus">
        {MENUS.map((menu) => (
          <Menu
            key={menu.label}
            label={menu.label}
            items={menu.items}
            libraryUnavailable={libraryUnavailable}
          />
        ))}
      </nav>
    </header>
  )
}
