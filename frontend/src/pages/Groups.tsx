import { useEffect, useState, type FormEvent } from 'react'
import { FolderTree, Plus } from 'lucide-react'
import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import { Card, CardHeader, PageHeader, Button, Loading, EmptyState } from '../components/ui'
import { EndpointTabs } from './Endpoints'

type Group = { id: string; name: string; device_count: number; created_at?: string }

export default function Groups() {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const load = () => api.get('/groups').then(r => setGroups(r.data))
  useEffect(() => { load() }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/groups', { name })
      setName('')
      load()
    } catch {
      setError('Could not create that group.')
    }
  }

  return (
    <>
      <PageHeader title="Endpoints" subtitle="Organize devices into groups for policies and reporting" />
      <EndpointTabs />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Device groups" subtitle={groups ? `${groups.length} groups` : undefined} />
          {!groups ? <Loading /> : groups.length === 0 ? (
            <EmptyState icon={<FolderTree size={20} />} title="No groups yet" body="Create a group, like a department or location, to organize your devices." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5">Group</th><th className="py-2.5 pr-5">Devices</th><th className="py-2.5 pr-5">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map(g => (
                  <tr key={g.id}>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3 font-medium text-slate-900">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-50 text-teal"><FolderTree size={15} /></span>
                        {g.name}
                      </span>
                    </td>
                    <td className="py-3 pr-5 text-slate-600">{g.device_count}</td>
                    <td className="py-3 pr-5 text-slate-600">{formatDate(g.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Add a group" />
          <form onSubmit={create} className="space-y-3 p-5">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Detroit Office" required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/15" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full"><Plus size={16} />Create group</Button>
            <p className="text-xs text-slate-500">Assigning devices to groups arrives with device policies.</p>
          </form>
        </Card>
      </div>
    </>
  )
}
