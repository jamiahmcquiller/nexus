import axios from 'axios'

const API = import.meta.env.VITE_API_URL || ''

export const api = axios.create({ baseURL: `${API}/api/v1` })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('nexus_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err?.response?.status === 401 && localStorage.getItem('nexus_token')) {
      localStorage.removeItem('nexus_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export type Device = {
  id: string
  hostname: string | null
  device_id: string
  enrollment_status: string
  agent_version: string | null
  last_checkin_at: string | null
  created_at: string | null
  attributes: DeviceAttributes
  groups?: string[]
}

export type DeviceAttributes = {
  department?: string
  assigned_user?: string
  serial_number?: string
  manufacturer?: string
  model?: string
  os?: { name?: string; version?: string; build?: string }
  hardware?: { cpu?: string; ram_gb?: number; disk_total_gb?: number; disk_free_gb?: number; architecture?: string }
  network?: { ip_address?: string; mac_address?: string }
  security?: { bitlocker?: boolean; firewall?: boolean; defender?: boolean; encryption_name?: string; antivirus_name?: string }
  platform?: string
  software?: { name: string; publisher?: string; version?: string }[]
  warranty?: Warranty
}

export type Warranty = {
  provider?: string
  coverage?: string
  start_date?: string
  end_date?: string
  purchase_date?: string
  order_number?: string
  notes?: string
  source?: string
  status?: 'active' | 'expiring' | 'expired' | 'unknown'
  days_left?: number | null
}

export type DeviceBrief = {
  id: string
  hostname: string | null
  department?: string
  assigned_user?: string
  os?: string
  online: boolean
  last_checkin_at: string | null
}
