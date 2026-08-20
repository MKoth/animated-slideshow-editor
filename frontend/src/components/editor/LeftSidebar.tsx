import { useUiStore } from '../../stores/uiStore'
import type { SidebarTab } from '../../stores/uiPrefs'
import { AnimationsPanel } from '../panels/AnimationsPanel'
import { AssetsPanel } from '../panels/AssetsPanel'
import { MaterialsPanel } from '../panels/MaterialsPanel'
import { RiggingPanel } from '../panels/RiggingPanel'
import { ScenePanel } from '../panels/ScenePanel'
import { SlidesPanel } from '../panels/SlidesPanel'

const TABS = [
  { id: 'assets', label: 'Assets' },
  { id: 'slides', label: 'Slides' },
  { id: 'scene', label: 'Scene' },
  { id: 'materials', label: 'Materials' },
  { id: 'animations', label: 'Animations' },
  { id: 'rigging', label: 'Rigging' },
] as const satisfies readonly { id: SidebarTab; label: string }[]

const PANELS: Record<SidebarTab, () => React.JSX.Element> = {
  assets: AssetsPanel,
  slides: SlidesPanel,
  scene: ScenePanel,
  materials: MaterialsPanel,
  animations: AnimationsPanel,
  rigging: RiggingPanel,
}

export function LeftSidebar({ width }: { width: number }) {
  const activeTab = useUiStore((state) => state.activeSidebarTab)
  const setActiveTab = useUiStore((state) => state.setActiveSidebarTab)
  const Panel = PANELS[activeTab]

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
        <Panel />
      </div>
    </aside>
  )
}
