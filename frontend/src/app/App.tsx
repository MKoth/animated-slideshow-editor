import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from '../components/errors/ErrorBoundary'
import { Notifications } from '../components/notifications/Notifications'
import { PasteDeltaModal } from '../components/panels/PasteDeltaModal'
import { EditorPage } from '../pages/EditorPage'
import { ScenarioMdModalPrototypeRoute } from '../components/ai/prototype/ScenarioMdModalPrototype'
import { useUiStore } from '../stores/uiStore'
import { EngineProvider } from './EngineProvider'

export default function App() {
  const theme = useUiStore((state) => state.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <>
      <ErrorBoundary>
        <EngineProvider>
          <Routes>
            <Route path="/" element={<EditorPage />} />
            {/* PROTOTYPE route for #457 — throwaway, remove before merging to main */}
            <Route path="/prototype/scenario-md" element={<ScenarioMdModalPrototypeRoute />} />
          </Routes>
        </EngineProvider>
      </ErrorBoundary>
      <Notifications />
      <PasteDeltaModal />
    </>
  )
}
