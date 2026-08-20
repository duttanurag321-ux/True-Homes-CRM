import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/AuthContext.jsx'
import { useScrollRestoration } from './lib/useScrollRestoration.js'
import BottomNav from './components/BottomNav.jsx'
import { SplashLoader } from './components/Loader.jsx'
import Login from './pages/Login.jsx'
import TodayWork from './pages/TodayWork.jsx'
import Pipeline from './pages/Pipeline.jsx'
import Leads from './pages/Leads.jsx'
import LeadDetail from './pages/LeadDetail.jsx'
import LeadForm from './pages/LeadForm.jsx'
import BulkUpload from './pages/BulkUpload.jsx'
import LeadPool from './pages/LeadPool.jsx'
import DailyReport from './pages/DailyReport.jsx'
import SVReport from './pages/SVReport.jsx'
import Settings from './pages/Settings.jsx'

function ScrollRestoration() {
  useScrollRestoration()
  return null
}

function Protected({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <SplashLoader />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

export default function App() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-base">
      <ScrollRestoration />
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route
          path="/*"
          element={
            <Protected>
              <div className="pb-24 safe-top">
                <Routes>
                  <Route path="/" element={<TodayWork />} />
                  <Route path="/pipeline" element={<Pipeline />} />
                  <Route path="/leads" element={<Leads />} />
                  <Route path="/leads/new" element={<LeadForm />} />
                  <Route path="/leads/upload" element={<BulkUpload />} />
                  <Route path="/leads/pool" element={<LeadPool />} />
                  <Route path="/leads/:id" element={<LeadDetail />} />
                  <Route path="/leads/:id/edit" element={<LeadForm />} />
                  <Route path="/reports/daily" element={<DailyReport />} />
                  <Route path="/reports/sv" element={<SVReport />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
              <BottomNav />
            </Protected>
          }
        />
      </Routes>
    </div>
  )
}
