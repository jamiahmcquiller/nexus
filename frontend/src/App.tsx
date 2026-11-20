import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-semibold text-gray-900">NEXUS</h1>
        <p className="text-sm text-gray-500">IT Operations & Security Management</p>
      </header>
      <main className="p-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium mb-4">Dashboard</h2>
          <p className="text-gray-600">Endpoint inventory console shell — MVP in progress.</p>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="border rounded p-4">
              <div className="text-2xl font-bold">—</div>
              <div className="text-sm text-gray-500">Endpoints</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-2xl font-bold">—</div>
              <div className="text-sm text-gray-500">Online</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-2xl font-bold">—</div>
              <div className="text-sm text-gray-500">Stale</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
