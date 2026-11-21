import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Endpoints from './pages/Endpoints'
import DeviceProfile from './pages/DeviceProfile'
import Enroll from './pages/Enroll'
import Groups from './pages/Groups'
import ComingSoon, { MODULES } from './pages/ComingSoon'

function RequireAuth({ children }: { children: ReactNode }) {
  return localStorage.getItem('nexus_token') ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="endpoints" element={<Endpoints />} />
          <Route path="endpoints/groups" element={<Groups />} />
          <Route path="endpoints/enroll" element={<Enroll />} />
          <Route path="endpoints/:id" element={<DeviceProfile />} />
          {['patches', 'vulnerabilities', 'software', 'service-desk', 'automation', 'compliance', 'reports'].map(k => (
            <Route key={k} path={k} element={<ComingSoon module={MODULES[k]} />} />
          ))}
          <Route path="admin/users" element={<ComingSoon module={MODULES.users} />} />
          <Route path="admin/settings" element={<ComingSoon module={MODULES.settings} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
