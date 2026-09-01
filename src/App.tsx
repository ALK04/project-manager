import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { KanbanPage } from '@/pages/KanbanPage'
import { BurndownPage } from '@/pages/BurndownPage'
import { BurnupPage } from '@/pages/BurnupPage'
import { GanttPage } from '@/pages/GanttPage'
import { AlternancePage } from '@/pages/AlternancePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { LoginPage } from '@/pages/LoginPage'
import { useAuth } from '@/hooks/useAuth'

function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">
        Chargement…
      </div>
    )
  }

  if (!user) return <LoginPage />

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <Routes>
            <Route path="/" element={<KanbanPage />} />
            <Route path="/burndown" element={<BurndownPage />} />
            <Route path="/burnup" element={<BurnupPage />} />
            <Route path="/gantt" element={<GanttPage />} />
            <Route path="/alternance" element={<AlternancePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
