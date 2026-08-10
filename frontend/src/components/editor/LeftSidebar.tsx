import { useUiStore } from '../../stores/uiStore'
import { AssetsPanel } from '../panels/AssetsPanel'
import { SlidesPanel } from '../panels/SlidesPanel'

const TABS = [
  { id: 'assets', label: 'Assets' },
  { id: 'slides', label: 'Slides' },
] as const

export function LeftSidebar({ width }: { width: number }) {
  const activeTab = useUiStore((state) => state.activeSidebarTab)
  const setActiveTab = useUiStore((state) => state.setActiveSidebarTab)

  return (
    <aside className="left-sidebar" style={{ width }}>
      <nav className="sidebar-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`sidebar-tab${activeTab === tab.id ? ' sidebar-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-content">
        {activeTab === 'assets' ? <AssetsPanel /> : <SlidesPanel />}
      </div>
    </aside>
  )
}
