import { useEffect, useRef, useState } from 'react'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useUiStore } from '../../stores/uiStore'
import { triggerAssetImport } from '../assets/importTrigger'

const IMPORT_ASSETS_ITEM = 'Import Assets'
const SNAP_TO_GRID_ITEM = 'Snap to Grid'

const MENUS = [
  {
    label: 'File',
    items: ['New Project', 'Open', 'Save'],
  },
  {
    label: 'Edit',
    items: ['Undo', 'Redo', SNAP_TO_GRID_ITEM],
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
  checkedItems?: ReadonlySet<string>
}

function Menu({ label, items, libraryUnavailable, checkedItems }: MenuProps) {
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
    } else if (item === SNAP_TO_GRID_ITEM) {
      useUiStore.getState().toggleGridSnap()
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
                {checkedItems?.has(item) ? '✓ ' : ''}
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
  const gridSnap = useUiStore((state) => state.gridSnap)
  const checkedItems = new Set(gridSnap ? [SNAP_TO_GRID_ITEM] : [])

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
            checkedItems={checkedItems}
          />
        ))}
      </nav>
    </header>
  )
}
