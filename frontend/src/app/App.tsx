import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from '../components/errors/ErrorBoundary'
import { Notifications } from '../components/notifications/Notifications'
import { EditorPage } from '../pages/EditorPage'
import { useUiStore } from '../stores/uiStore'

export default function App() {
  const theme = useUiStore((state) => state.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<EditorPage />} />
        </Routes>
      </ErrorBoundary>
      <Notifications />
    </>
  )
}
