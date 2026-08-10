import { useEffect, useRef, useState } from 'react'
import { useNotificationStore } from '../../stores/notificationStore'

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
    items: ['Import Assets'],
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
}

function Menu({ label, items }: MenuProps) {
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

  const handleItemClick = () => {
    useNotificationStore.getState().notify('Not implemented yet.')
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
              <button className="menu__item" role="menuitem" onClick={handleItemClick}>
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
  return (
    <header className="menu-bar">
      <span className="menu-bar__title">AI Slideshow Editor</span>
      <nav className="menu-bar__menus">
        {MENUS.map((menu) => (
          <Menu key={menu.label} label={menu.label} items={menu.items} />
        ))}
      </nav>
    </header>
  )
}
