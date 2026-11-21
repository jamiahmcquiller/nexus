import { Link } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { Card, PageHeader, Button, Badge } from '../components/ui'

export type ModuleInfo = { title: string; subtitle: string; phase: string; features: string[] }

export const MODULES: Record<string, ModuleInfo> = {
  patches: { title: 'Patch Management', subtitle: 'Keep every device up to date', phase: 'Phase 3',
    features: ['Patch catalog', 'Approval queue', 'Deployment policies', 'Scheduled deployments', 'Failed job monitoring'] },
  vulnerabilities: { title: 'Vulnerability Management', subtitle: 'Find and fix security weaknesses', phase: 'Phase 2',
    features: ['CVE inventory', 'Severity distribution', 'Affected endpoint list', 'Remediation status', 'Risk prioritization'] },
  software: { title: 'Software Management', subtitle: 'Applications across your fleet', phase: 'Phase 3',
    features: ['Software inventory across all devices', 'Unapproved software alerts', 'Application deployment'] },
  'service-desk': { title: 'Service Desk', subtitle: 'Incidents and requests in one queue', phase: 'Phase 4',
    features: ['Incident queue', 'Service requests', 'Technician assignments', 'Approval workflows', 'SLA tracking', 'Employee self-service portal'] },
  automation: { title: 'Automation', subtitle: 'Let routine work run itself', phase: 'Phase 4',
    features: ['Workflows', 'Scheduled tasks', 'Triggered actions'] },
  compliance: { title: 'Security & Compliance', subtitle: 'Prove your controls are working', phase: 'Phase 4',
    features: ['Security controls', 'Risk assessments', 'Evidence collection', 'Audit management', 'Compliance reporting'] },
  reports: { title: 'Reports', subtitle: 'Operational and security analytics', phase: 'Phase 3',
    features: ['Inventory reports', 'Health trends', 'Scheduled exports'] },
  users: { title: 'Users & Roles', subtitle: 'Who can do what in NEXUS', phase: 'Core MVP',
    features: ['Invite teammates', 'Roles: owner, admin, technician, auditor', 'Single sign-on'] },
  settings: { title: 'Settings', subtitle: 'Organization configuration', phase: 'Core MVP',
    features: ['Organization profile', 'Integrations', 'Data retention'] },
}

export default function ComingSoon({ module }: { module: ModuleInfo }) {
  return (
    <>
      <PageHeader title={module.title} subtitle={module.subtitle} />
      <Card className="mx-auto max-w-2xl p-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-teal-50 text-teal"><Clock size={22} /></span>
        <div className="mt-4"><Badge tone="teal">{module.phase}</Badge></div>
        <h2 className="mt-3 text-lg font-semibold text-slate-900">{module.title} is on the roadmap</h2>
        <p className="mt-1 text-sm text-slate-500">Here is what this workspace will include:</p>
        <ul className="mx-auto mt-5 grid max-w-md grid-cols-1 gap-2 text-left sm:grid-cols-2">
          {module.features.map(f => (
            <li key={f} className="flex items-center gap-2 rounded-lg bg-cloud px-3 py-2 text-sm text-slate-700">
              <span className="h-1.5 w-1.5 rounded-full bg-teal" />{f}
            </li>
          ))}
        </ul>
        <Link to="/endpoints" className="mt-6 inline-block"><Button variant="secondary">Go to Endpoint Management</Button></Link>
      </Card>
    </>
  )
}
