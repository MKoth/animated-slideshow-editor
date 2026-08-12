import { useEffect, useRef, useState } from 'react'
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
} from '../../app/clipboardActions'
import {
  applyZOrder,
  canApplyZOrder,
  Z_ORDER_BY_LABEL,
  Z_ORDER_ITEMS,
} from '../../app/zOrderActions'
import { useEngine } from '../../app/useEngine'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { useClipboardStore } from '../../stores/clipboardStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useUiStore } from '../../stores/uiStore'
import { triggerAssetImport } from '../assets/importTrigger'

const IMPORT_ASSETS_ITEM = 'Import Assets'
const SNAP_TO_GRID_ITEM = 'Snap to Grid'
const COPY_ITEM = 'Copy'
const PASTE_ITEM = 'Paste'
const DUPLICATE_ITEM = 'Duplicate'
const DELETE_ITEM = 'Delete'

const MENUS = [
  {
    label: 'File',
    items: ['New Project', 'Open', 'Save'],
  },
  {
    label: 'Edit',
    items: [
      'Undo',
      'Redo',
      COPY_ITEM,
      PASTE_ITEM,
      DUPLICATE_ITEM,
      DELETE_ITEM,
      ...Z_ORDER_ITEMS.map((item) => item.label),
      SNAP_TO_GRID_ITEM,
    ],
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
  disabledItems?: ReadonlySet<string>
  onItemClick?: (item: string) => boolean
}

function Menu({
  label,
  items,
  libraryUnavailable,
  checkedItems,
  disabledItems,
  onItemClick,
}: MenuProps) {
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
    if (!onItemClick?.(item)) {
      if (item === IMPORT_ASSETS_ITEM) {
        triggerAssetImport()
      } else if (item === SNAP_TO_GRID_ITEM) {
        useUiStore.getState().toggleGridSnap()
      } else {
        useNotificationStore.getState().notify('Not implemented yet.')
      }
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
                disabled={
                  disabledItems?.has(item) || (item === IMPORT_ASSETS_ITEM && libraryUnavailable)
                }
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
  const { engine, dispatch } = useEngine()
  const libraryUnavailable = useAssetLibraryStore((state) => state.unavailable)
  const gridSnap = useUiStore((state) => state.gridSnap)
  const selectedIds = useSelectionStore((state) => state.selectedIds)
  const clipboardCount = useClipboardStore((state) => state.items.length)
  const checkedItems = new Set(gridSnap ? [SNAP_TO_GRID_ITEM] : [])
  const disabledItems = new Set<string>()
  if (selectedIds.length === 0) {
    disabledItems.add(COPY_ITEM)
    disabledItems.add(DUPLICATE_ITEM)
    disabledItems.add(DELETE_ITEM)
  }
  if (clipboardCount === 0) {
    disabledItems.add(PASTE_ITEM)
  }
  for (const item of Z_ORDER_ITEMS) {
    if (!canApplyZOrder(engine, item.mode)) {
      disabledItems.add(item.label)
    }
  }

  const handleItemClick = (item: string): boolean => {
    if (item === COPY_ITEM) {
      copySelection(engine)
    } else if (item === PASTE_ITEM) {
      pasteClipboard(dispatch)
    } else if (item === DUPLICATE_ITEM) {
      duplicateSelection(engine, dispatch)
    } else if (item === DELETE_ITEM) {
      deleteSelection(engine, dispatch)
    } else {
      const mode = Z_ORDER_BY_LABEL.get(item)
      if (mode) {
        applyZOrder(engine, dispatch, mode)
      } else {
        return false
      }
    }
    return true
  }

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
            disabledItems={disabledItems}
            onItemClick={handleItemClick}
          />
        ))}
      </nav>
    </header>
  )
}
