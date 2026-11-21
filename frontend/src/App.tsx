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
import Vulnerabilities, { VulnerabilityDetail } from './pages/Vulnerabilities'
import Patches from './pages/Patches'
import Software from './pages/Software'
import ServiceDesk, { TicketDetail, EmployeePortal } from './pages/ServiceDesk'
import Automation from './pages/Automation'
import Compliance from './pages/Compliance'
import Reports from './pages/Reports'
import WarrantyPage from './pages/Warranty'

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
          <Route path="endpoints/warranty" element={<WarrantyPage />} />
          <Route path="endpoints/:id" element={<DeviceProfile />} />
          <Route path="vulnerabilities" element={<Vulnerabilities />} />
          <Route path="vulnerabilities/:id" element={<VulnerabilityDetail />} />
          <Route path="patches" element={<Patches />} />
          <Route path="software" element={<Software />} />
          <Route path="service-desk" element={<ServiceDesk />} />
          <Route path="service-desk/portal" element={<EmployeePortal />} />
          <Route path="service-desk/:id" element={<TicketDetail />} />
          <Route path="automation" element={<Automation />} />
          <Route path="compliance" element={<Compliance />} />
          <Route path="reports" element={<Reports />} />
          <Route path="admin/users" element={<ComingSoon module={MODULES.users} />} />
          <Route path="admin/settings" element={<ComingSoon module={MODULES.settings} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
